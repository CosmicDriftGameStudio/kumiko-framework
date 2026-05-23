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

import {
  asRawClient,
  fetchOne,
  selectMany,
  updateMany,
} from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  EXT_USER_DATA,
  type Registry,
  type TenantId,
  type UserDataDeleteHook,
  type UserDataDeleteStrategy,
} from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resolveRetentionPolicyForTenant } from "../data-retention";
import { tenantMembershipsTable } from "../tenant";
import { USER_STATUS, userTable } from "../user";

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
}

export async function runForgetCleanup(
  args: RunForgetCleanupArgs,
): Promise<RunForgetCleanupResult> {
  const { db, registry, now, sendDeletionExecutedEmail } = args;

  // Step 1: Find users with expired grace period.
  // lte with Instant: no bun-db operator covers this — raw SQL.
  const dueUsers = await asRawClient(db).unsafe<{ id: string }>(
    `SELECT id FROM read_users WHERE status = $1 AND grace_period_end <= $2`,
    [USER_STATUS.DeletionRequested, now.toString()],
  );

  if (dueUsers.length === 0) {
    return { processedUserIds: [], hookCallsAttempted: 0, errors: [] };
  }

  // Step 2: Sammle alle EXT_USER_DATA-Usages einmalig — Liste der
  // (entityName, deleteHook)-Pairs aller registrierten Provider-Features.
  const usages = registry.getExtensionUsages(EXT_USER_DATA);
  const hookEntries: HookEntry[] = usages
    .map((u): HookEntry | null => {
      const opts = (u.options ?? {}) as { delete?: UserDataDeleteHook }; // @cast-boundary engine-payload
      return opts.delete ? { entityName: u.entityName, deleteHook: opts.delete } : null;
    })
    .filter((x): x is HookEntry => x !== null);

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
  /** Tenant-Memberships VOR Tx — Email-Template kann das nutzen. */
  readonly tenantIdsBeforeDelete: readonly TenantId[];
}

async function processUser(args: {
  db: DbRunner;
  registry: Registry;
  userId: string;
  hookEntries: readonly HookEntry[];
}): Promise<ProcessUserResult> {
  const { db, registry, userId, hookEntries } = args;
  const errors: ForgetCleanupError[] = [];
  let hookCallsAttempted = 0;

  // Atom 5b — userEmail VOR der Tx cachen. user-Hook (user-data-rights-
  // defaults) anonymisiert email/displayName/passwordHash IN der Tx.
  // Nach der Tx ist email = "deleted-{id}@{tenant}.example" oder NULL.
  // Memory-cache laesst Atom-5b-Callback nach success-flip den
  // ORIGINAL-email an App-Author-Callback geben.
  const userPreTx = await fetchOne<{ email: string | null }>(db, userTable, { id: userId });
  const userEmailBeforeDelete =
    userPreTx?.email && userPreTx.email.length > 0 ? userPreTx.email : null;

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
  // nur dieser User zurueck, andere User bleiben commit-fest. Drizzle
  // mappt das in nested-Tx auf SAVEPOINT, in top-level auf BEGIN — die
  // `transaction()`-API ist auf DbRunner uniform.
  //
  // Cast `db as {transaction: ...}` ist eine TS-Limitation: DbRunner ist
  // `DbConnection | DbTx`, beide haben `.transaction()`, aber TS kann
  // die Signaturen ueber die Union nicht unifizieren (PgDatabase vs
  // PgTransaction haben unterschiedliche Generics). Cast macht das
  // Strukturelle explizit, kein Hack.
  let txSucceeded = false;
  let currentTenantId: TenantId | null = null;
  let currentEntityName: string | null = null;
  try {
    await (db as { begin: (fn: (tx: DbRunner) => Promise<void>) => Promise<void> }).begin(
      async (tx) => {
        for (const tenantId of tenantList) {
          currentTenantId = tenantId;
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
            await entry.deleteHook({ db: tx, tenantId, userId }, strategy);
          }
        }

        // Status-Flip in derselben Sub-Tx. Falls einer der Hooks oben
        // geworfen hat, kommen wir hier nicht an — die Tx rollback'd
        // alles, der User bleibt im DeletionRequested-Status, naechster
        // Run retried.
        await updateMany(tx, userTable, { status: USER_STATUS.Deleted }, { id: userId });
        txSucceeded = true;
      },
    );
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
    tenantIdsBeforeDelete,
  };
}

// Pseudo-Tenant fuer User ohne aktive Memberships. RFC4122-konforme
// Null-UUID. Tenant-scoped Hooks finden hier nichts (no-op),
// tenant-agnostische Hooks (z.B. user) operieren auf der globalen
// User-Row und ignorieren tenantId.
const SYSTEM_TENANT_ID_FOR_ORPHANS = "00000000-0000-0000-0000-000000000000" as TenantId;

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
