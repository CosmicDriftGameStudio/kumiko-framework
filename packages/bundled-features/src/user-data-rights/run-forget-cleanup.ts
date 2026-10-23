import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
// Forget-cleanup runner — pure-function pipeline.
//
// After the grace period, this runner processes users in DeletionRequested
// state and triggers EXT_USER_DATA delete hooks in every tenant where the user
// is or was a member, using membership history from kumiko_events.
//
// **Cross-tenant iteration:** a request in tenant A must remove the user's data
// in all of their tenants, including tenants they left before the request.
//
// **Strategy dispatch:** each entity's data-retention policy determines whether
// to run "delete" or "anonymize". A blockDelete policy always produces
// "anonymize", leaving the data object in place while removing its association
// with the person.
//
// **Per-user atomicity:** each user runs in its own sub-transaction
// (db.transaction → SAVEPOINT when an outer transaction is active, BEGIN
// otherwise). A failing hook rolls back only that user's transaction, while
// other users and previously completed status changes remain commit-able.
// Without this isolation, the outer dispatcher transaction would roll back the
// entire cleanup run on the first hook failure.
//
// **Idempotency:** hooks are designed to be idempotent, so rerunning after
// crash recovery is safe. Flipping the status to "Deleted" at the end keeps
// the user out of subsequent runs.
//
// **Error handling:** a throwing hook must not stop the run. Errors are
// collected and returned for operator visibility, while a user with failed
// hooks remains in DeletionRequested for automatic retry.

import {
  configuredPiiSubjectKms,
  type KmsAdapter,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createTenantDb,
  type DbRunner,
  entityEventName,
  executeRawQuery,
  fetchOne,
  nullBlindIndexesForSubject,
  selectMany,
  WritePurposes,
} from "@cosmicdrift/kumiko-framework/db";
import { deleteStoredFileAndDerivatives } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  type EscapeHatchAuditSink,
  EXT_USER_DATA,
  EXT_USER_DATA_ORDER,
  extensionUsageEscapeHatchReason,
  type Registry,
  type TenantId,
  type TenantUserModel,
  type UserDataDeleteHook,
  type UserDataDeleteStrategy,
  type UserDataStorageProvider,
} from "@cosmicdrift/kumiko-framework/engine";
import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import {
  createEscapeHatchReporter,
  UNATTRIBUTED_ACTOR,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  purgeSearchDocumentsForSubject,
  type SearchAdapter,
} from "@cosmicdrift/kumiko-framework/search";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  resolveRetentionPolicyForTenant,
  resolveTenantRetentionPreset,
} from "../data-retention/index.ts";
import {
  type DeleteFileBytes,
  decryptStoredPii,
  purgeFilesReachingSubject,
  runInSubTransaction,
} from "../shared/index.ts";
import { tenantMembershipsTable } from "../tenant/index.ts";
import { USER_STATUS, userTable } from "../user/index.ts";
import { selectUsersDueForForgetCleanup } from "./db/queries/forget-cleanup.ts";
import { updateUserLifecycle } from "./lib/update-user-lifecycle.ts";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

/**
 * Callback for the forget-cleanup path. A callback failure propagates to the
 * r.job wrapper so the jobs feature can persist the failed run.
 *
 * **executedAt:** The time of the delete flip, passed as an ISO string so the
 * app author can insert it into an email template.
 *
 * **tenantIds:** All memberships the user had before deletion. An email
 * template can use this to describe which tenant accounts were deleted. The
 * list is empty for an orphan user with no memberships.
 */
export type SendDeletionExecutedEmailFn = (args: {
  readonly userId: string;
  readonly userEmail: string;
  /** Stored user.locale (free-form, cached PRE-tx alongside the email) — lets
   *  the default mailer render in the recipient's language. */
  readonly userLocale: string | null;
  readonly tenantIds: readonly TenantId[];
  readonly executedAt: string;
}) => Promise<void>;

export interface RunForgetCleanupArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  /**
   * Injects the current time so tests can control it without mocking the date.
   */
  readonly now: Instant;

  /** Sends an optional email notification after the delete flip. Without a
   * callback, the worker remains silent because the user already received the
   * request-deletion email and grace-period reminder. */
  readonly sendDeletionExecutedEmail?: SendDeletionExecutedEmailFn;

  /**
   * Per-tenant file-storage-provider resolver (the forget cron builds it from
   * the mounted file-foundation, mirroring the export cron). Threaded into
   * every delete-hook's ctx so file-aware hooks erase binaries from the same
   * store the upload/export path uses. Omitted → hooks skip binary cleanup.
   */
  readonly buildStorageProvider?: (
    tenantId: TenantId,
  ) => Promise<UserDataStorageProvider | undefined>;

  /**
   * KMS for crypto-shredding: erases the per-user subject key after the
   * delete-hooks, inside the per-user sub-tx, right before the status flip.
   * Defaults to the boot-configured adapter (configurePiiSubjectKms);
   * explicit arg is the test seam. Omitted + none configured → plaintext
   * deployment, nothing to shred.
   */
  readonly kms?: KmsAdapter;

  /**
   * Search adapter for purging derived Meili docs of searchable subject-PII.
   * Same seam as forget-subject. Omitted → no search purge (apps
   * without Meili).
   */
  readonly searchAdapter?: SearchAdapter;

  /**
   * App-level tenant-occupancy model (resolved from the `tenantModel` config by
   * the cron/handler). The pipeline refines it PER TENANT with a sole-member
   * check before handing `tenantModel` to each delete-hook, so tenant-scoped
   * erasure only happens where it's actually safe. Omitted → `"multi-user"`
   * (no tenant-scoped erasure).
   */
  readonly tenantModel?: TenantUserModel;

  // Sourced from the owning job's ctx (_escapeHatchAuditSink,
  // systemUser.id); attributes+audits any EXT_USER_DATA usage's declared
  // escapeHatch when its delete hook calls ctx.db.unsafeRaw().
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly escapeHatchAuditLog?: Logger;
  readonly actor?: string;
}

export interface ForgetCleanupError {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly message: string;
}

/** A hook reporting `{status:"incomplete", reason}` — no throw, no
 *  rollback, the user still gets flipped to Deleted (see Header
 *  "incomplete is not a hard failure"). Collected for operator
 *  visibility, NOT in `errors` (those stand for hook throws + rollback). */
export interface ForgetCleanupIncomplete {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly reason: string;
  /** True when a LATER hook in the same user's sub-tx threw, rolling back
   *  the DB rows (including the status flip) — but this hook's own
   *  non-transactional side effect (e.g. an already-issued S3 delete,
   *  a provider API call) already ran and does NOT get undone by that
   *  rollback. The user is still DeletionRequested and will retry, but
   *  this partial external effect needs its own operator follow-up. */
  readonly rolledBack: boolean;
}

export interface RunForgetCleanupResult {
  /** Users flipped from DeletionRequested to Deleted during this run. */
  readonly processedUserIds: readonly string[];
  /** Number of entity-hook calls that actually ran, whether successful or failed. */
  readonly hookCallsAttempted: number;
  /** Hook errors collected for operator visibility; the run continues. */
  readonly errors: readonly ForgetCleanupError[];
  /** Hooks that reported `{status:"incomplete"}` — partial success, user still Deleted. */
  readonly incomplete: readonly ForgetCleanupIncomplete[];
}

interface HookEntry {
  readonly entityName: string;
  readonly deleteHook: UserDataDeleteHook;
  /** Lower runs first. Owner-column-preserving redaction declares a negative
   * order so it precedes owner-nulling hooks on the same entity (see sort below). */
  readonly order: number;
  readonly escapeHatchReason: string | undefined;
}

function buildHookDb(
  db: DbRunner,
  tenantId: TenantId,
  entry: HookEntry,
  args: {
    readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
    readonly escapeHatchAuditLog?: Logger;
    readonly actor?: string;
  },
) {
  const report = createEscapeHatchReporter({
    handler: `${EXT_USER_DATA}:${entry.entityName}`,
    tenantId,
    actor: args.actor ?? UNATTRIBUTED_ACTOR,
    sink: args.escapeHatchAuditSink,
    log: args.escapeHatchAuditLog ?? createFallbackLogger("user-data-rights"),
  });
  return createTenantDb({
    db,
    tenantId,
    mode: "tenant",
    grants: {
      unsafeRaw:
        entry.escapeHatchReason !== undefined ? { reason: entry.escapeHatchReason } : undefined,
      report,
    },
  });
}

// EXT_USER_DATA delete-hooks default here; a hook that redacts data keyed on an
// owner column it doesn't own must register a lower order so it runs BEFORE any
// hook that nulls that column. See custom-fields wire-user-data-rights.ts.
const HOOK_ORDER_DEFAULT = EXT_USER_DATA_ORDER.DEFAULT;

// Hook-reported reasons are external input (provider error messages can embed
// user-controlled filenames/emails) — strip newlines before a single-line
// console.warn so a crafted reason can't forge extra log lines, and cap the
// length against a log-flood. The unsanitized reason still lands in the
// returned `incomplete` entry untouched.
// Secret-read audit discriminator, not a QN; the value must stay stable for the audit trail.
export const FORGET_CLEANUP_HANDLER_NAME = "user-data-rights:run-forget-cleanup" as const;

export function sanitizeReasonForLog(reason: string): string {
  return reason.replace(/[\r\n]+/g, " ").slice(0, 500);
}

// Cross-tenant by design: the due-user and membership reads on the given runner and raw hook
// statements must see every tenant, whatever RLS scope the caller (job, operator handler) runs in.
export function runForgetCleanup(args: RunForgetCleanupArgs): Promise<RunForgetCleanupResult> {
  return runInSystemRowLevelSecurityScope(
    "forget cleanup anonymizes users across all tenants",
    () => forgetDueUsers(args),
  );
}

async function forgetDueUsers(args: RunForgetCleanupArgs): Promise<RunForgetCleanupResult> {
  const { db, registry, now, sendDeletionExecutedEmail, buildStorageProvider } = args;
  const kms = args.kms ?? configuredPiiSubjectKms();
  const appTenantModel: TenantUserModel = args.tenantModel ?? "multi-user";

  // Step 1: Find users with expired grace period.
  const dueUsers = await selectUsersDueForForgetCleanup(
    db,
    USER_STATUS.DeletionRequested,
    now.toString(),
  );

  if (dueUsers.length === 0) {
    return { processedUserIds: [], hookCallsAttempted: 0, errors: [], incomplete: [] };
  }

  // Step 2: collect all EXT_USER_DATA usages once, i.e. the
  // (entityName, deleteHook) pairs of all registered provider features.
  const usages = registry.getExtensionUsages(EXT_USER_DATA);
  const hookEntries: HookEntry[] = usages
    .map((u): HookEntry | null => {
      const opts = (u.options ?? {}) as { delete?: UserDataDeleteHook; order?: number }; // @cast-boundary engine-payload
      if (!opts.delete) return null;
      const order = typeof opts.order === "number" ? opts.order : HOOK_ORDER_DEFAULT;
      return {
        entityName: u.entityName,
        deleteHook: opts.delete,
        order,
        escapeHatchReason: extensionUsageEscapeHatchReason(u),
      };
    })
    .filter((x): x is HookEntry => x !== null)
    // Order ascending. Array.sort is ES2019-stable, so equal orders keep
    // registration order; correctness here needs only distinct orders, not
    // stability. Guarantees owner-preserving redaction (negative order) runs
    // before owner-nulling hooks on the same entity, independent of feature
    // registration order.
    .sort((a, b) => a.order - b.order);

  const errors: ForgetCleanupError[] = [];
  const incomplete: ForgetCleanupIncomplete[] = [];
  const processedUserIds: string[] = [];
  let hookCallsAttempted = 0;

  // Step 3: iterate per user, each in its own sub-transaction (see header).
  for (const user of dueUsers) {
    const userResult = await processUser({
      db,
      registry,
      userId: user.id,
      hookEntries,
      buildStorageProvider,
      appTenantModel,
      kms,
      searchAdapter: args.searchAdapter,
      escapeHatchAuditSink: args.escapeHatchAuditSink,
      escapeHatchAuditLog: args.escapeHatchAuditLog,
      actor: args.actor,
    });
    hookCallsAttempted += userResult.hookCallsAttempted;
    errors.push(...userResult.errors);
    incomplete.push(...userResult.incomplete);
    if (userResult.success) {
      processedUserIds.push(user.id);

      // userEmail was cached BEFORE the transaction because the user hook
      // anonymizes it inside the transaction.
      //
      // The email is best-effort: a send failure must not abort the batch after the
      // user's sub-transaction has committed. Otherwise the job would be marked
      // failed, and a retry would find no eligible users, causing a silent miss.
      // console.warn is the only operator-visible reporting path because the
      // runForgetCleanup args do not carry AppContext.log (pure-function pattern).
      if (sendDeletionExecutedEmail && userResult.userEmailBeforeDelete) {
        try {
          await sendDeletionExecutedEmail({
            userId: user.id,
            userEmail: userResult.userEmailBeforeDelete,
            userLocale: userResult.userLocaleBeforeDelete,
            tenantIds: userResult.tenantIdsBeforeDelete,
            executedAt: now.toString(),
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:run-forget-cleanup] sendDeletionExecutedEmail failed userId=${user.id} err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  return { processedUserIds, hookCallsAttempted, errors, incomplete };
}

interface ProcessUserResult {
  readonly success: boolean;
  readonly hookCallsAttempted: number;
  readonly errors: readonly ForgetCleanupError[];
  readonly incomplete: readonly ForgetCleanupIncomplete[];
  /** The email address cached before the transaction because the user hook
   * anonymizes it in the transaction. Null means the row was absent or the
   * email was empty during the pre-transaction lookup. */
  readonly userEmailBeforeDelete: string | null;
  /** user.locale VOR Tx gecacht — Default-Mailer rendert in Empfaenger-Sprache. */
  readonly userLocaleBeforeDelete: string | null;
  /** Tenant memberships captured before the transaction deletes them, for use by
   * the email template. */
  readonly tenantIdsBeforeDelete: readonly TenantId[];
}

async function processUser(args: {
  db: DbRunner;
  registry: Registry;
  userId: string;
  hookEntries: readonly HookEntry[];
  buildStorageProvider?: (tenantId: TenantId) => Promise<UserDataStorageProvider | undefined>;
  appTenantModel: TenantUserModel;
  kms?: KmsAdapter;
  searchAdapter?: SearchAdapter;
  escapeHatchAuditSink?: EscapeHatchAuditSink;
  escapeHatchAuditLog?: Logger;
  actor?: string;
}): Promise<ProcessUserResult> {
  const { db, registry, userId, hookEntries, buildStorageProvider, appTenantModel, kms } = args;
  const errors: ForgetCleanupError[] = [];
  const incomplete: Omit<ForgetCleanupIncomplete, "rolledBack">[] = [];
  let hookCallsAttempted = 0;

  // Cache the email before the transaction because the user hook anonymizes
  // email/displayName/passwordHash inside it. The cache lets the callback after
  // a successful status flip receive the original email address.
  const userPreTx = await fetchOne<{ email: string | null; locale: string | null }>(db, userTable, {
    id: userId,
  });
  const userEmailBeforeDelete =
    userPreTx?.email && userPreTx.email.length > 0
      ? await decryptStoredPii(userPreTx.email, "email", "user-data-rights:forget-cleanup")
      : null;
  const userLocaleBeforeDelete = userPreTx?.locale ?? null;

  const memberships = await selectMany<{ tenantId: TenantId }>(db, tenantMembershipsTable, {
    userId,
  });
  // Capture memberships before the transaction deletes them so the email
  // callback receives the original tenant list. Orphan users provide an empty
  // list.
  const tenantIdsBeforeDelete: readonly TenantId[] = memberships.map((m) => m.tenantId);

  // Departed tenants: removeMember deletes only the projection row, so data
  // the user left behind there (e.g. note mentions) must still be reached.
  const historicalTenantIds = await readHistoricalMembershipTenantIds(db, userId);
  const hookTenantIds = [...new Set([...tenantIdsBeforeDelete, ...historicalTenantIds])];

  // Edge case "0 tenants" (neither membership nor history): the hook loop still
  // runs with a pseudo tenant. The user hook is tenant-agnostic and MUST run so
  // email/displayName/passwordHash get anonymized; tenant-scoped hooks find
  // nothing there and no-op. Without this path status=Deleted would be set
  // while the original PII stays — compliant-looking, but not compliant.
  const tenantList: TenantId[] =
    hookTenantIds.length > 0 ? hookTenantIds : [SYSTEM_TENANT_ID_FOR_ORPHANS];

  // Hooks and the status flip run atomically per user. A hook failure rolls back
  // only that user, while other users remain commit-able. runInSubTransaction
  // uses `.begin` (BEGIN) for a top-level connection and `.savepoint`
  // (SAVEPOINT) when the dispatcher is already inside an outer transaction.
  let txSucceeded = false;
  let currentTenantId: TenantId | null = null;
  let currentEntityName: string | null = null;
  try {
    await runInSubTransaction(db, async (tx) => {
      // Discover + purge search docs for this subject BEFORE any delete
      // hook runs. purgeSearchDocumentsForSubject finds candidate
      // rows via a live SELECT on each entity's read-table — a hook that
      // hard-deletes a row (UserDataDeleteStrategy "delete") makes that row
      // invisible to a purge running afterward, permanently stranding its
      // plaintext PII in the search index. Running the purge first means it
      // sees every row a hook is about to touch, delete or not.
      if (args.searchAdapter) {
        const subject = { kind: "user" as const, userId };
        await purgeSearchDocumentsForSubject(
          tx,
          registry.features,
          args.searchAdapter,
          subjectIdToKey(subject),
          subject,
        );
      }

      // Same ordering rationale: the files are found through the entity rows a
      // hook may hard-delete, and a file whose uploader differs from the owner
      // is never reached by the fileRef hook (it keys on insertedById).
      await purgeFilesReachingSubject({
        registry,
        db: tx,
        subject: { kind: "user", userId },
        subjectKey: subjectIdToKey({ kind: "user", userId }),
        resolveDeleteBytes: resolveForgetFileBytesDeleter(buildStorageProvider),
        missingStorage: {
          mode: "skip",
          warn: (tenantId) =>
            // biome-ignore lint/suspicious/noConsole: misconfiguration visibility, same as the fileRef delete hook
            console.warn(
              `[user-data-rights:run-forget-cleanup] no file provider resolvable for tenantId=${tenantId} - file binaries of userId=${userId} are NOT deleted (rows kept). Mount file-foundation + a file-provider-* feature so erasure can reach the binaries.`,
            ),
        },
      });

      for (const tenantId of tenantList) {
        currentTenantId = tenantId;
        // Refine the app-level model to THIS tenant: "single-user" only if the
        // tenant truly has one member, so a stray invite can't let a per-user
        // forget erase a co-member's tenant-scoped data (money-path safety).
        const tenantModel = await resolveEffectiveTenantModel(tx, tenantId, appTenantModel);
        // Resolved ONCE per tenant (not per hookEntry below) — the compliance-
        // profile lookup it does internally is a single indexed read; N entities
        // re-deriving it per tenant would be N reads for the same answer.
        const tenantPreset = await resolveTenantRetentionPreset({ db: tx, registry, tenantId });
        for (const entry of hookEntries) {
          currentEntityName = entry.entityName;
          const policy = await resolveRetentionPolicyForTenant({
            db: tx,
            registry,
            tenantId,
            entityName: entry.entityName,
            preloadedTenantPreset: tenantPreset,
          });
          const strategy = policyToStrategy(policy.policy?.strategy ?? null);

          hookCallsAttempted++;
          const hookResult = await entry.deleteHook(
            {
              db: buildHookDb(tx, tenantId, entry, {
                escapeHatchAuditSink: args.escapeHatchAuditSink,
                escapeHatchAuditLog: args.escapeHatchAuditLog,
                actor: args.actor,
              }),
              registry,
              tenantId,
              userId,
              buildStorageProvider,
              tenantModel,
              userEmailBeforeDelete,
            },
            strategy,
          );
          // "incomplete" is not a hard failure (see Header): no throw,
          // no rollback, eraseKey + status flip proceed unchanged.
          // Only collected + logged for operator visibility.
          if (hookResult?.status === "incomplete") {
            incomplete.push({
              userId,
              tenantId,
              entityName: entry.entityName,
              reason: hookResult.reason,
            });
            // biome-ignore lint/suspicious/noConsole: operator-visibility for partial hook completion
            console.warn(
              `[user-data-rights:run-forget-cleanup] hook incomplete userId=${userId} tenantId=${tenantId} entityName=${entry.entityName} reason=${sanitizeReasonForLog(hookResult.reason)}`,
            );
          }
        }
      }

      // Crypto-shredding: erase the user's subject key AFTER the hooks and
      // BEFORE the status flip. The KMS is not a tx participant, so ordering
      // is what makes this crash-safe: eraseKey-throw → tx rollback → user
      // stays DeletionRequested → next run retries; flip-throw after a
      // successful erase → retry re-runs the idempotent hooks and eraseKey
      // (idempotent: a repeat erase keeps the original tombstone, an unknown
      // subject gets one). Erasing after
      // the flip instead would risk a permanent silent miss: user already
      // Deleted, no run ever picks him up again, key stays live.
      if (kms) {
        await kms.eraseKey(
          { kind: "user", userId },
          {
            requestId: "user-data-rights:run-forget-cleanup",
            userId,
            eraseReason: "user-data-rights:forget",
          },
        );
        // Null blind-index columns immediately after erasing the subject key; otherwise
        // the deterministic HMAC would remain equality-matchable until the next
        // rebuild. Keeping this in the sub-transaction makes the sweep rollback
        // with the rest of the user's cleanup.
        await nullBlindIndexesForSubject(
          tx,
          registry.features,
          subjectIdToKey({ kind: "user", userId }),
        );
      }

      // Flip the status in the same sub-transaction. If a hook throws, execution
      // never reaches this point, so the user remains in DeletionRequested for
      // the next retry.
      await updateUserLifecycle(
        tx,
        userId,
        { status: USER_STATUS.Deleted },
        { writePurpose: WritePurposes.erasure },
      );
      txSucceeded = true;
    });
  } catch (e) {
    // Track the failing hook so operators see its tenant and entity instead of a
    // generic sub-transaction error.
    errors.push({
      userId,
      tenantId: currentTenantId ?? ("" as TenantId),
      entityName: currentEntityName ?? "<unknown>",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    success: txSucceeded,
    hookCallsAttempted,
    errors,
    // Reported either way — a rolled-back sub-tx doesn't undo an
    // "incomplete" hook's own non-transactional side effect (S3 delete,
    // provider call), so dropping the report entirely would hide exactly
    // the case its own reason string describes ("would report a
    // not-yet-deleted user as partially cleaned up" — true of the DB rows,
    // not of that external effect). `rolledBack` lets the operator tell
    // the two situations apart instead of losing the signal outright.
    incomplete: incomplete.map((i) => ({ ...i, rolledBack: !txSucceeded })),
    userEmailBeforeDelete,
    userLocaleBeforeDelete,
    tenantIdsBeforeDelete,
  };
}

// A resolution failure collapses to "no storage" like in the fileRef delete hook; a failing
// byte delete throws through the sweep so the per-user sub-tx rolls back and the next run retries.
function resolveForgetFileBytesDeleter(
  buildStorageProvider: RunForgetCleanupArgs["buildStorageProvider"],
): (tenantId: TenantId) => Promise<DeleteFileBytes | undefined> {
  return async (tenantId) => {
    if (!buildStorageProvider) return undefined;
    try {
      const provider = await buildStorageProvider(tenantId);
      return (
        provider &&
        ((key) => deleteStoredFileAndDerivatives(key, provider, "user-data-rights:forget-cleanup"))
      );
    } catch {
      // skip: provider unresolvable (not configured) -> files skipped with a warn, like the hook
      return undefined;
    }
  };
}

// Use a pseudo-tenant for users with no active or historical memberships.
// Tenant-scoped hooks find nothing there, while tenant-agnostic hooks such as
// the user hook still operate on the global user row and ignore tenantId.
const SYSTEM_TENANT_ID_FOR_ORPHANS = "00000000-0000-0000-0000-000000000000" as TenantId;

// "single-user" requires BOTH the app config AND a runtime sole-member check —
// the config asserts the deployment model, the count guards against a stray
// invite that would make a per-user forget delete a co-member's tenant-scoped
// data. Only queried when the app opted into "single-user" (multi-user apps
// never reach the destructive path, so no extra query for them).
async function resolveEffectiveTenantModel(
  db: DbRunner,
  tenantId: TenantId,
  appTenantModel: TenantUserModel,
): Promise<TenantUserModel> {
  if (appTenantModel !== "single-user") return "multi-user";
  // Only "exactly one member vs. more than one" matters here — a LIMIT 2
  // read answers that without pulling every historical membership row.
  const members = await selectMany<{ userId: string }>(
    db,
    tenantMembershipsTable,
    { tenantId },
    { limit: 2 },
  );
  if (members.length !== 1) return "multi-user";
  return (await everHadMultipleMembers(db, tenantId)) ? "multi-user" : "single-user";
}

// removeMemberWrite only deletes the tenant-membership PROJECTION row — the
// event history survives forever, and a departed member's own tenant-scoped
// data rows (contributor-style records with no per-user column) can
// outlive their membership. A live count of 1 is therefore not
// enough: a tenant that ever had >1 distinct member must stay multi-user for
// the forget path even after everyone but one is removed, or the sole
// remaining member's forget request wipes the departed co-member's leftover
// rows.
//
// Filter by payload->>'tenantId' (not the event column tenant_id): cross-
// tenant SystemAdmin adds land under the actor's tenant_id.
//
// Counting created-ROWS against distinct userIds latched a tenant to
// multi-user as soon as its sole member was removed and re-added —
// two created-events, one identity, no co-member ever. The fail-safe only
// needs to cover payloads whose userId cannot be READ, so the unreadable
// remainder is measured directly instead of inferred from the row count.
// NULLIF folds an empty-string userId into that remainder (it names nobody).
async function everHadMultipleMembers(db: DbRunner, tenantId: TenantId): Promise<boolean> {
  const eventType = entityEventName("tenant-membership", "created");
  const rows = await executeRawQuery<{
    event_count: number;
    readable_users: number;
    distinct_users: number;
  }>(
    db,
    `SELECT
       COUNT(*)::int AS event_count,
       COUNT(NULLIF(payload->>'userId', ''))::int AS readable_users,
       COUNT(DISTINCT NULLIF(payload->>'userId', ''))::int AS distinct_users
     FROM kumiko_events
     WHERE aggregate_type = 'tenant-membership'
       AND type = $1
       AND payload->>'tenantId' = $2`,
    [eventType, tenantId],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.distinct_users > 1) return true;
  // Unreadable / missing userId payloads: fail-safe to multi-user, each one
  // could name a second member.
  return row.event_count > row.readable_users;
}

// Filter by payload (not the event column tenant_id) for the same reason as
// everHadMultipleMembers: cross-tenant SystemAdmin adds are billed to the
// actor's tenant.
async function readHistoricalMembershipTenantIds(
  db: DbRunner,
  userId: string,
): Promise<TenantId[]> {
  const rows = await executeRawQuery<{ tenant_id: string }>(
    db,
    `SELECT DISTINCT payload->>'tenantId' AS tenant_id
     FROM kumiko_events
     WHERE aggregate_type = 'tenant-membership'
       AND type = $1
       AND payload->>'userId' = $2
       AND NULLIF(payload->>'tenantId', '') IS NOT NULL`,
    [entityEventName("tenant-membership", "created"), userId],
  );
  return rows.map((row) => row.tenant_id as TenantId); // @cast-boundary db-row
}

// Map retention.strategy to user-data-rights.UserDataDeleteStrategy.
//   - "anonymize" / "blockDelete" → "anonymize": retention requirements keep
//     the data physically present while removing its association with the person.
//   - "hardDelete" / "softDelete" / null → "delete" (default).
//
// Keeping this mapping in one function makes drift between retention strategies
// and user-data-rights hooks explicit and testable.
export function policyToStrategy(
  retentionStrategy: "hardDelete" | "softDelete" | "anonymize" | "blockDelete" | null,
): UserDataDeleteStrategy {
  if (retentionStrategy === "anonymize" || retentionStrategy === "blockDelete") {
    return "anonymize";
  }
  return "delete";
}
