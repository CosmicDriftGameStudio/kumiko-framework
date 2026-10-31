import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { userSessionTable } from "../sessions/index.ts";
import type { InactivityState } from "./inactivity-plan.ts";
import { tenantInactivityStateTable } from "./state-table.ts";

export type StoredInactivityState = InactivityState & { readonly cycleId: string };

type StateRow = StoredInactivityState & { readonly id: string };

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

export async function loadInactivityState(db: TenantDb): Promise<StoredInactivityState | null> {
  const row = await db.fetchOne<StateRow>(tenantInactivityStateTable, { tenantId: db.tenantId });
  if (!row) return null;
  return {
    cycleId: row.cycleId,
    firstSeenAt: row.firstSeenAt,
    lastActivityAt: row.lastActivityAt,
    lastExemptAt: row.lastExemptAt,
    lastWarnedAt: row.lastWarnedAt,
    postponedDueAt: row.postponedDueAt,
    warningsSent: row.warningsSent,
  };
}

function sameInstant(a: Temporal.Instant | null, b: Temporal.Instant | null): boolean {
  if (a === null || b === null) return a === b;
  return a.epochMilliseconds === b.epochMilliseconds;
}

export function isSameInactivityState(
  a: StoredInactivityState | null,
  b: StoredInactivityState,
): boolean {
  return (
    a !== null &&
    a.cycleId === b.cycleId &&
    a.warningsSent === b.warningsSent &&
    sameInstant(a.firstSeenAt, b.firstSeenAt) &&
    sameInstant(a.lastActivityAt, b.lastActivityAt) &&
    sameInstant(a.lastExemptAt, b.lastExemptAt) &&
    sameInstant(a.lastWarnedAt, b.lastWarnedAt) &&
    sameInstant(a.postponedDueAt, b.postponedDueAt)
  );
}

// Writes only when something changed, so a run that decides nothing stays read-only.
export async function saveInactivityState(
  db: TenantDb,
  previous: StoredInactivityState | null,
  next: StoredInactivityState,
): Promise<void> {
  // skip: nothing changed, so the run stays read-only
  if (isSameInactivityState(previous, next)) return;
  if (previous === null) {
    await db.insertOne(tenantInactivityStateTable, { tenantId: db.tenantId, ...next });
  } else {
    await db.updateMany(tenantInactivityStateTable, next, { tenantId: db.tenantId });
  }
}

// The sessions table keeps the activity marker; reading it here avoids a write per request.
export async function loadNewestSessionActivity(db: TenantDb): Promise<Temporal.Instant | null> {
  const [newest] = await db.selectMany<{ lastSeenAt: Temporal.Instant | null }>(
    userSessionTable,
    { tenantId: db.tenantId, lastSeenAt: { gte: EPOCH } },
    { limit: 1, orderBy: { col: "lastSeenAt", direction: "desc" } },
  );
  return newest?.lastSeenAt ?? null;
}
