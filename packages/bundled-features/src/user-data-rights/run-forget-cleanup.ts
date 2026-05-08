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
// (alle writeHandler laufen in `db.transaction(...)`) den ganzen
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

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  EXT_USER_DATA,
  type Registry,
  type TenantId,
  type UserDataDeleteHook,
  type UserDataDeleteStrategy,
} from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { and, eq, lte } from "drizzle-orm";
import { resolveRetentionPolicyForTenant } from "../data-retention";
import { tenantMembershipsTable } from "../tenant";
import { USER_STATUS, userTable } from "../user";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export interface RunForgetCleanupArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  /**
   * Now-Injection — Tests koennen den Wert pinnen ohne Date-Mock.
   * Pattern aus data-retention/keep-for.ts (advisor-pinned).
   */
  readonly now: Instant;
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
  const { db, registry, now } = args;

  // Step 1: Find users with expired grace period.
  // @cast-boundary db-row — drizzle-select gibt Record-Shape zurueck.
  const dueUsers = (await db
    .select({ id: userTable["id"] })
    .from(userTable)
    .where(
      and(
        eq(userTable["status"], USER_STATUS.DeletionRequested),
        lte(userTable["gracePeriodEnd"], now),
      ),
    )) as Array<{ id: string }>;

  if (dueUsers.length === 0) {
    return { processedUserIds: [], hookCallsAttempted: 0, errors: [] };
  }

  // Step 2: Sammle alle EXT_USER_DATA-Usages einmalig — Liste der
  // (entityName, deleteHook)-Pairs aller registrierten Provider-Features.
  const usages = registry.getExtensionUsages(EXT_USER_DATA);
  const hookEntries: HookEntry[] = usages
    .map((u): HookEntry | null => {
      const opts = (u.options ?? {}) as { delete?: UserDataDeleteHook };
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
    }
  }

  return { processedUserIds, hookCallsAttempted, errors };
}

interface ProcessUserResult {
  readonly success: boolean;
  readonly hookCallsAttempted: number;
  readonly errors: readonly ForgetCleanupError[];
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

  // Memberships fuer diesen User holen — alle Tenants in denen er Mitglied ist.
  // @cast-boundary db-row.
  const memberships = (await db
    .select({ tenantId: tenantMembershipsTable["tenantId"] })
    .from(tenantMembershipsTable)
    .where(eq(tenantMembershipsTable["userId"], userId))) as Array<{
    tenantId: TenantId;
  }>;

  // Edge-Case "0 Memberships": User hat alle Tenants schon verlassen
  // bevor Forget triggerte. Ohne Tenant kann der file-ref-Hook keine
  // Files finden (tenant-scoped). Wir koennen den user-Hook trotzdem
  // laufen lassen, aber das geht ohne Memberships nicht sauber durch
  // den Hook-Loop (Hook-ctx braucht tenantId). Praktisch: skippen mit
  // status=Deleted-Flip, der user-row wird bei den naechsten User-
  // Cleanup-Job-Runs (DPO-driven) hard-deleted oder bleibt liegen.
  if (memberships.length === 0) {
    await db
      .update(userTable)
      .set({ status: USER_STATUS.Deleted })
      .where(eq(userTable["id"], userId));
    return { success: true, hookCallsAttempted: 0, errors: [] };
  }

  // Per-User-Sub-Tx: hooks + status-flip atomar. Bei Hook-Throw rollt
  // nur dieser User zurueck, andere User bleiben commit-fest. Drizzle
  // mappt das in nested-Tx auf SAVEPOINT, in top-level auf BEGIN —
  // die `transaction()`-API ist auf DbRunner uniform.
  let txSucceeded = false;
  try {
    await (
      db as { transaction: (fn: (tx: DbRunner) => Promise<void>) => Promise<void> }
    ).transaction(async (tx) => {
      for (const tenantId of memberships.map((m) => m.tenantId)) {
        for (const entry of hookEntries) {
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
      // gewirft hat, kommen wir hier nicht an — die Tx rollback'd
      // alles, der User bleibt im DeletionRequested-Status, naechster
      // Run retried.
      await tx
        .update(userTable)
        .set({ status: USER_STATUS.Deleted })
        .where(eq(userTable["id"], userId));
      txSucceeded = true;
    });
  } catch (e) {
    // Pro Hook ein Error-Eintrag waere granularer aber wir sind nach
    // dem Throw schon raus aus dem Loop. Operator sieht "User X failed,
    // see logs"; die concrete Hook-Failure-Zeile ist in den Server-Logs.
    errors.push({
      userId,
      tenantId: memberships[0]?.tenantId ?? ("" as TenantId),
      entityName: "<sub-transaction>",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return { success: txSucceeded, hookCallsAttempted, errors };
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
