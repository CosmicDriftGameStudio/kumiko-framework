// Forget-Cleanup-Runner (S2.U5b) — pure-Function Pipeline.
//
// Nach abgelaufener Grace-Period (S2.U5a setzt gracePeriodEnd) iteriert
// dieser Runner ueber alle User in DeletionRequested-State und triggert
// die EXT_USER_DATA-delete-Hooks pro Membership-Tenant.
//
// **Cross-Tenant-Iteration:** Ein User-Forget-Antrag in Tenant A muss
// die Daten des Users in ALLEN seinen Tenants entfernen — siehe
// docs/plans/architecture/user-data-rights.md "Cross-Tenant-Semantik".
//
// **Strategy-Dispatch:** Pro Entity entscheidet die data-retention-
// policy (per-Tenant Override moeglich), ob "delete" oder "anonymize"
// gefahren wird. blockDelete (Aufbewahrungs-Pflicht) ergibt zwingend
// "anonymize" — Daten-Objekt bleibt physisch da, Personen-Bezug raus.
//
// **Per-User-Atomicity (advisor-pinned):** Jeder User wird in einer
// eigenen Sub-Transaction abgewickelt (db.transaction → SAVEPOINT wenn
// Outer-Tx aktiv, BEGIN sonst). Folge: ein failing Hook bei User A
// rollt nur dessen Sub-Tx zurueck, User B + bisherige User-Status-Flips
// bleiben commit-able. Ohne diese Sub-Tx wuerde der Outer-Dispatcher-Tx
// (alle writeHandler laufen in `db.begin(...)`) den ganzen
// Cleanup-Run beim ersten Hook-Throw zurueckrollen.
//
// **Idempotenz:** Hooks sind idempotent designed (siehe
// engine/extensions/user-data.ts). Doppellauf nach Crash-Recovery muss
// safe sein. Status-Flip auf "Deleted" am Ende sorgt dafuer, dass next
// Lauf den User nicht mehr findet.
//
// **Error-Handling:** Ein hook der wirft soll den Lauf NICHT stoppen —
// andere User sollen weiter abgearbeitet werden. Errors werden
// gesammelt + zurueckgegeben fuer Operator-Visibility. Ein User mit
// gefailten Hooks bleibt im DeletionRequested-Status (next Lauf
// retried automatisch).

import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  type KmsAdapter,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import { type DbRunner, nullBlindIndexesForSubject } from "@cosmicdrift/kumiko-framework/db";
import {
  EXT_USER_DATA,
  EXT_USER_DATA_ORDER,
  type Registry,
  type TenantId,
  type TenantUserModel,
  type UserDataDeleteHook,
  type UserDataDeleteStrategy,
  type UserDataStorageProvider,
} from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resolveRetentionPolicyForTenant } from "../data-retention";
import { decryptStoredPii } from "../shared";
import { tenantMembershipsTable } from "../tenant";
import { USER_STATUS, userTable } from "../user";
import { selectUsersDueForForgetCleanup } from "./db/queries/forget-cleanup";
import { updateUserLifecycle } from "./lib/update-user-lifecycle";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

/**
 * Notification-Callback fuer den Forget-Cleanup-Pfad (Atom 5b). Pattern
 * matched Atom 5 (Export). Throw bubbelt zum r.job-Wrap; jobs-feature
 * persistiert den failed-Run in jobRunsTable (siehe
 * jobs/__tests__/jobs-feature.integration.ts Scenario 2 — der throw-
 * Pfad eines r.job-handlers wird dort gepinnt).
 *
 * **executedAt:** Zeitpunkt des delete-Flips. Wird als ISO-String
 * uebergeben damit App-Author den frei in Email-Template einbauen kann.
 *
 * **tenantIds:** alle Memberships die der User vor dem Delete hatte.
 * Email-Template kann das nutzen ("dein Account in Tenant X+Y wurde
 * geloescht"). Bei orphan-User (0 Memberships) ist die Liste leer.
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
   * Now-Injection — Tests koennen den Wert pinnen ohne Date-Mock.
   * Pattern aus data-retention/keep-for.ts (advisor-pinned).
   */
  readonly now: Instant;

  /** Atom 5b — Email-Notification beim delete-flip. Optional;
   *  ohne Callback laeuft Worker still (User hatte schon
   *  request-deletion-Email + grace-period-Erinnerung). */
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
   * App-level tenant-occupancy model (resolved from the `tenantModel` config by
   * the cron/handler). The pipeline refines it PER TENANT with a sole-member
   * check before handing `tenantModel` to each delete-hook, so tenant-scoped
   * erasure only happens where it's actually safe. Omitted → `"multi-user"`
   * (no tenant-scoped erasure).
   */
  readonly tenantModel?: TenantUserModel;
}

export interface ForgetCleanupError {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly message: string;
}

export interface RunForgetCleanupResult {
  /** User die in diesem Lauf von DeletionRequested → Deleted geflippt wurden. */
  readonly processedUserIds: readonly string[];
  /** Anzahl entity-hook-calls die wirklich gelaufen sind (success oder fail). */
  readonly hookCallsAttempted: number;
  /** Hook-Errors fuer Operator-Visibility. Lauf bricht nicht ab — siehe Header. */
  readonly errors: readonly ForgetCleanupError[];
}

interface HookEntry {
  readonly entityName: string;
  readonly deleteHook: UserDataDeleteHook;
  /** Lower runs first. Owner-column-preserving redaction declares a negative
   * order so it precedes owner-nulling hooks on the same entity (see sort below). */
  readonly order: number;
}

// EXT_USER_DATA delete-hooks default here; a hook that redacts data keyed on an
// owner column it doesn't own must register a lower order so it runs BEFORE any
// hook that nulls that column. See custom-fields wire-user-data-rights.ts.
const HOOK_ORDER_DEFAULT = EXT_USER_DATA_ORDER.DEFAULT;

export async function runForgetCleanup(
  args: RunForgetCleanupArgs,
): Promise<RunForgetCleanupResult> {
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
    return { processedUserIds: [], hookCallsAttempted: 0, errors: [] };
  }

  // Step 2: Sammle alle EXT_USER_DATA-Usages einmalig — Liste der
  // (entityName, deleteHook)-Pairs aller registrierten Provider-Features.
  const usages = registry.getExtensionUsages(EXT_USER_DATA);
  const hookEntries: HookEntry[] = usages
    .map((u): HookEntry | null => {
      const opts = (u.options ?? {}) as { delete?: UserDataDeleteHook; order?: number }; // @cast-boundary engine-payload
      if (!opts.delete) return null;
      const order = typeof opts.order === "number" ? opts.order : HOOK_ORDER_DEFAULT;
      return { entityName: u.entityName, deleteHook: opts.delete, order };
    })
    .filter((x): x is HookEntry => x !== null)
    // Order ascending. Array.sort is ES2019-stable, so equal orders keep
    // registration order; correctness here needs only distinct orders, not
    // stability. Guarantees owner-preserving redaction (negative order) runs
    // before owner-nulling hooks on the same entity, independent of feature
    // registration order.
    .sort((a, b) => a.order - b.order);

  const errors: ForgetCleanupError[] = [];
  const processedUserIds: string[] = [];
  let hookCallsAttempted = 0;

  // Step 3: Pro User iterieren — eigene Sub-Tx pro User (siehe Header).
  for (const user of dueUsers) {
    const userResult = await processUser({
      db,
      registry,
      userId: user.id,
      hookEntries,
      buildStorageProvider,
      appTenantModel,
      kms,
    });
    hookCallsAttempted += userResult.hookCallsAttempted;
    errors.push(...userResult.errors);
    if (userResult.success) {
      processedUserIds.push(user.id);

      // Atom 5b — Email-Notification nach success-flip. userEmail wurde
      // VOR der Tx gecacht (user-Hook anonymisiert in der Tx).
      //
      // Best-effort: ein Email-Throw fuer User A darf nicht den Batch
      // killen — User A ist bereits geloescht (Sub-Tx committed), und
      // die Users B, C, ... muessen noch verarbeitet werden. Throw waere
      // hier ein Bug: r.job-Wrap markiert den Run failed, retry findet
      // keine User mehr im DeletionRequested+grace-expired-Status (alle
      // schon Deleted) → silent miss. console.warn ist die einzige
      // Operator-Sichtbarkeit — runForgetCleanup-args fuehren AppContext.
      // log aktuell nicht durch (pure-function-Pattern).
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

  return { processedUserIds, hookCallsAttempted, errors };
}

interface ProcessUserResult {
  readonly success: boolean;
  readonly hookCallsAttempted: number;
  readonly errors: readonly ForgetCleanupError[];
  /** Atom 5b: userEmail VOR Tx gecacht (user-Hook anonymisiert in Tx).
   *  null wenn user-Row beim Pre-Tx-Lookup nicht (mehr) existiert oder
   *  email leer ist. */
  readonly userEmailBeforeDelete: string | null;
  /** user.locale VOR Tx gecacht — Default-Mailer rendert in Empfaenger-Sprache. */
  readonly userLocaleBeforeDelete: string | null;
  /** Tenant-Memberships VOR Tx — Email-Template kann das nutzen. */
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
}): Promise<ProcessUserResult> {
  const { db, registry, userId, hookEntries, buildStorageProvider, appTenantModel, kms } = args;
  const errors: ForgetCleanupError[] = [];
  let hookCallsAttempted = 0;

  // Atom 5b — userEmail VOR der Tx cachen. user-Hook (user-data-rights-
  // defaults) anonymisiert email/displayName/passwordHash IN der Tx.
  // Nach der Tx ist email = "deleted-{id}@{tenant}.example" oder NULL.
  // Memory-cache laesst Atom-5b-Callback nach success-flip den
  // ORIGINAL-email an App-Author-Callback geben.
  const userPreTx = await fetchOne<{ email: string | null; locale: string | null }>(db, userTable, {
    id: userId,
  });
  const userEmailBeforeDelete =
    userPreTx?.email && userPreTx.email.length > 0
      ? await decryptStoredPii(userPreTx.email, "email", "user-data-rights:forget-cleanup")
      : null;
  const userLocaleBeforeDelete = userPreTx?.locale ?? null;

  // Memberships fuer diesen User holen — alle Tenants in denen er Mitglied ist.
  const memberships = await selectMany<{ tenantId: TenantId }>(db, tenantMembershipsTable, {
    userId,
  });
  // tenant-Liste fuer Atom 5b Email — Memberships VOR Tx, weil hooks
  // memberships in der Tx loeschen. Orphan-User (0 memberships) liefert
  // [] in Email-args; App-Author-Template kann das case-handlen.
  const tenantIdsBeforeDelete: readonly TenantId[] = memberships.map((m) => m.tenantId);

  // Edge-Case "0 Memberships": User hat alle Tenants schon verlassen
  // bevor Forget triggerte. Wir laufen den Hook-Loop trotzdem mit einem
  // Pseudo-Tenant — der user-Hook (user-data-rights-defaults) ist
  // tenant-agnostisch und MUSS laufen damit email/displayName/passwordHash
  // anonymisiert werden. Tenant-scoped Hooks (z.B. fileRefDeleteHook)
  // finden im Pseudo-Tenant nichts und sind no-op. Ohne diesen Pfad
  // wuerde status=Deleted gesetzt waehrend Original-PII liegen bleibt
  // — sieht compliant aus, ist es nicht (advisor-Finding S2.U5b.fix1).
  const tenantList: TenantId[] =
    memberships.length > 0 ? memberships.map((m) => m.tenantId) : [SYSTEM_TENANT_ID_FOR_ORPHANS];

  // Per-User-Sub-Tx: hooks + status-flip atomar. Bei Hook-Throw rollt
  // nur dieser User zurueck, andere User bleiben commit-fest. Die Sub-Tx
  // nestet korrekt: eine Top-Level-Connection oeffnet sie via `.begin`
  // (BEGIN), eine TransactionSql — der Fall im Dispatcher, wo jeder
  // writeHandler bereits IN der Outer-Tx laeuft — via `.savepoint`
  // (SAVEPOINT). Siehe runInSubTransaction.
  let txSucceeded = false;
  let currentTenantId: TenantId | null = null;
  let currentEntityName: string | null = null;
  try {
    await runInSubTransaction(db, async (tx) => {
      for (const tenantId of tenantList) {
        currentTenantId = tenantId;
        // Refine the app-level model to THIS tenant: "single-user" only if the
        // tenant truly has one member, so a stray invite can't let a per-user
        // forget erase a co-member's tenant-scoped data (money-path safety).
        const tenantModel = await resolveEffectiveTenantModel(tx, tenantId, appTenantModel);
        for (const entry of hookEntries) {
          currentEntityName = entry.entityName;
          const policy = await resolveRetentionPolicyForTenant({
            db: tx,
            registry,
            tenantId,
            entityName: entry.entityName,
          });
          const strategy = policyToStrategy(policy.policy?.strategy ?? null);

          hookCallsAttempted++;
          await entry.deleteHook(
            {
              db: tx,
              registry,
              tenantId,
              userId,
              buildStorageProvider,
              tenantModel,
              userEmailBeforeDelete,
            },
            strategy,
          );
        }
      }

      // Crypto-shredding: erase the user's subject key AFTER the hooks and
      // BEFORE the status flip. The KMS is not a tx participant, so ordering
      // is what makes this crash-safe: eraseKey-throw → tx rollback → user
      // stays DeletionRequested → next run retries; flip-throw after a
      // successful erase → retry re-runs the idempotent hooks and eraseKey
      // (contractually a no-op on an erased/unknown subject). Erasing after
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
        // Blind-Index-Sweep (#818): bidx-Spalten des erased Subjects sofort
        // nullen — sonst bliebe der deterministische HMAC bis zum nächsten
        // Rebuild equality-matchbar (Linkage-Fenster). In der Sub-Tx, damit
        // ein Rollback auch den Sweep zurücknimmt.
        await nullBlindIndexesForSubject(
          tx,
          registry.features,
          subjectIdToKey({ kind: "user", userId }),
        );
      }

      // Status-Flip in derselben Sub-Tx. Falls einer der Hooks oben
      // geworfen hat, kommen wir hier nicht an — die Tx rollback'd
      // alles, der User bleibt im DeletionRequested-Status, naechster
      // Run retried.
      await updateUserLifecycle(tx, userId, { status: USER_STATUS.Deleted });
      txSucceeded = true;
    });
  } catch (e) {
    // currentTenantId/currentEntityName tracken den Failing-Hook —
    // Operator sieht "Hook fileRef in Tenant A failed for user X" statt
    // generisches "<sub-transaction>".
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
    userEmailBeforeDelete,
    userLocaleBeforeDelete,
    tenantIdsBeforeDelete,
  };
}

// Per-user sub-transaction, nesting-aware across both db shapes:
//   - top-level connection (Bun.SQL / postgres-js Sql) → `.begin` (BEGIN)
//   - TransactionSql (inside the dispatcher's outer tx, where every
//     writeHandler already runs) → `.savepoint` (SAVEPOINT)
// A TransactionSql has no `.begin`, so the previous unconditional `.begin`
// threw "is not a function" on every user when invoked through the dispatcher
// (the cron path) → zero deletions in production, while direct-connection tests
// stayed green. Selecting the available method makes the sub-tx work in both
// contexts; on throw the savepoint rolls back just this user (others survive).
async function runInSubTransaction(
  db: DbRunner,
  fn: (tx: DbRunner) => Promise<void>,
): Promise<void> {
  // `db` is already the raw runner (the handler passes ctx.db.raw, the tests a
  // top-level connection) — cast to read the transaction surface directly,
  // without asRawClient (a test-only escape hatch). A top-level connection
  // exposes `.begin`; a TransactionSql only `.savepoint`. They are mutually
  // exclusive, so prefer whichever is present.
  const runner = db as {
    begin?: (f: (tx: DbRunner) => Promise<void>) => Promise<void>;
    savepoint?: (f: (tx: DbRunner) => Promise<void>) => Promise<void>;
  };
  // savepoint-FIRST — empirisch (Bun 1.3.14) sind die Flächen NICHT
  // mutually exclusive: eine TransactionSql exposed begin UND savepoint,
  // nur die Top-Level-Connection hat ausschließlich begin. begin-first
  // wählte im Tx-Fall das nested BEGIN (Prod-Incident-Klasse, s. Header);
  // savepoint-first trifft im Tx-Fall den Savepoint und fällt top-level
  // sauber auf begin zurück.
  const open = runner.savepoint ?? runner.begin;
  if (!open) {
    throw new Error(
      "runForgetCleanup: db exposes neither .begin nor .savepoint — cannot open a per-user sub-transaction",
    );
  }
  await open.call(runner, fn);
}

// Pseudo-Tenant fuer User ohne aktive Memberships. RFC4122-konforme
// Null-UUID. Tenant-scoped Hooks finden hier nichts (no-op),
// tenant-agnostische Hooks (z.B. user) operieren auf der globalen
// User-Row und ignorieren tenantId.
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
  return members.length === 1 ? "single-user" : "multi-user";
}

// Mapping retention.strategy → user-data-rights.UserDataDeleteStrategy.
//   - "anonymize" / "blockDelete" → "anonymize" (Aufbewahrungs-Pflicht
//     blockDelete: Daten muessen physisch bleiben, nur Personen-Bezug raus)
//   - "hardDelete" / "softDelete" / null → "delete" (Default)
//
// Eigene Funktion damit Strategie-Drift zwischen retention-strategies
// und user-data-rights-Hooks an EINER Stelle dokumentiert + getestet
// werden kann (siehe run-forget-cleanup.test.ts).
export function policyToStrategy(
  retentionStrategy: "hardDelete" | "softDelete" | "anonymize" | "blockDelete" | null,
): UserDataDeleteStrategy {
  if (retentionStrategy === "anonymize" || retentionStrategy === "blockDelete") {
    return "anonymize";
  }
  return "delete";
}
