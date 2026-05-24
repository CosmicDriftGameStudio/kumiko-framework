// Event-Store Admin-API — Marten-Bypass für Legacy-Daten-Importe.
// Spec + Verhalten: docs/plans/features/event-store-admin-api.md
//
// Guard-Rail: dieses Modul ist NICHT aus event-store/index.ts re-exportiert.
// Import nur via deep-path `@cosmicdrift/kumiko-framework/event-store/admin-api`. Das
// Guard-Script `scripts/guard-admin-api.ts` blockt Aufrufe aus App-Code —
// Allowlist: samples/*/migration/, scripts/migrations/, die Definition
// selbst, das Guard-Script selbst.

import type { DbRunner } from "../db";
import { isUniqueViolation } from "../db/pg-error";
import { asRawClient } from "../db/query";
import type { TenantId } from "../engine/types";
import { VersionConflictError } from "./errors";
import type { EventMetadata } from "./event-store";

export type RawEventToAppend = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  // Predecessor version. 0 writes a new stream at version 1; > 0 requires
  // the predecessor to exist (same UUID, same tenant). Mirrors EventToAppend.
  readonly expectedVersion: number;
  readonly type: string;
  readonly eventVersion?: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: EventMetadata;
  // Historisch preserved — MUSS gesetzt sein, kein Default auf now().
  readonly createdAt: Temporal.Instant;
  // Historisch preserved. Legacy-UserId oder 'system' für pre-auth Daten.
  // Bewusst getrennt von metadata.userId: der Migration-Runner läuft unter
  // einer eigenen Service-Identität, der Legacy-Actor ist der Ursprung.
  readonly createdBy: string;
};

// Mirrors append()'s two-path structure: typed builder equivalent for v=0,
// INSERT … SELECT … WHERE EXISTS gate for v>0. Caller-supplied createdAt +
// createdBy skip the usual userResolver/now() paths.
export async function appendRaw(runner: DbRunner, event: RawEventToAppend): Promise<void> {
  const newVersion = event.expectedVersion + 1;
  const eventVersion = event.eventVersion ?? 1;

  try {
    if (event.expectedVersion === 0) {
      await insertRawFirst(runner, event, newVersion, eventVersion);
    } else {
      await insertRawSubsequent(runner, event, newVersion, eventVersion);
    }
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new VersionConflictError(event.aggregateId, event.expectedVersion);
    }
    throw e;
  }
}

async function insertRawFirst(
  runner: DbRunner,
  event: RawEventToAppend,
  newVersion: number,
  eventVersion: number,
): Promise<void> {
  await asRawClient(runner).unsafe(
    `INSERT INTO "kumiko_events" (
       aggregate_id, aggregate_type, tenant_id, version,
       type, event_version, payload, metadata, created_at, created_by
     )
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10)`,
    [
      event.aggregateId,
      event.aggregateType,
      event.tenantId,
      newVersion,
      event.type,
      eventVersion,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata),
      event.createdAt.toString(),
      event.createdBy,
    ],
  );
}

async function insertRawSubsequent(
  runner: DbRunner,
  event: RawEventToAppend,
  newVersion: number,
  eventVersion: number,
): Promise<void> {
  const rows = (await asRawClient(runner).unsafe(
    `INSERT INTO "kumiko_events" (
       aggregate_id, aggregate_type, tenant_id, version,
       type, event_version, payload, metadata, created_at, created_by
     )
     SELECT $1::uuid, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10
     WHERE EXISTS (
       SELECT 1 FROM "kumiko_events"
       WHERE aggregate_id = $1::uuid
         AND version = $11
         AND tenant_id = $3::uuid
     )
     RETURNING id`,
    [
      event.aggregateId,
      event.aggregateType,
      event.tenantId,
      newVersion,
      event.type,
      eventVersion,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata),
      event.createdAt.toString(),
      event.createdBy,
      event.expectedVersion,
    ],
  )) as ReadonlyArray<{ id: string }>;
  if (rows.length === 0) {
    throw new VersionConflictError(event.aggregateId, event.expectedVersion);
  }
}

// Batch append. One multi-VALUES INSERT — atomic by PG statement semantics.
// Three pre-flight checks identify the specific conflicting aggregate, so the
// thrown VersionConflictError points at a real event (not at a batch-first
// placeholder). The INSERT's UNIQUE constraint is still the authoritative
// gate — pre-flight is for diagnostic precision, not correctness.
export async function appendRawBatch(
  runner: DbRunner,
  events: readonly RawEventToAppend[],
): Promise<void> {
  const firstEvent = events[0];
  // skip: empty batch is a no-op by contract — callers that chunk a stream
  // into size-N batches shouldn't need to guard the tail-case themselves.
  if (!firstEvent) return;

  verifyContiguousWithinBatch(events);
  await verifyPredecessors(runner, events);
  await verifyNoDuplicates(runner, events);

  const params: unknown[] = [];
  const valuesClauses = events.map((e) => {
    const newVersion = e.expectedVersion + 1;
    const eventVersion = e.eventVersion ?? 1;
    const baseIdx = params.length;
    params.push(
      e.aggregateId,
      e.aggregateType,
      e.tenantId,
      newVersion,
      e.type,
      eventVersion,
      JSON.stringify(e.payload),
      JSON.stringify(e.metadata),
      e.createdAt.toString(),
      e.createdBy,
    );
    return `($${baseIdx + 1}::uuid, $${baseIdx + 2}, $${baseIdx + 3}::uuid, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}::jsonb, $${baseIdx + 8}::jsonb, $${baseIdx + 9}::timestamptz, $${baseIdx + 10})`;
  });

  try {
    await asRawClient(runner).unsafe(
      `INSERT INTO "kumiko_events" (
         aggregate_id, aggregate_type, tenant_id, version,
         type, event_version, payload, metadata, created_at, created_by
       )
       VALUES ${valuesClauses.join(", ")}`,
      params,
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Pre-flight ran but lost a race against a concurrent writer. Rare for
      // migration (single-runner) but possible; we can't name the exact row.
      throw new VersionConflictError(firstEvent.aggregateId, firstEvent.expectedVersion);
    }
    throw e;
  }
}

// Defense-in-depth against a buggy event-mapper: within one batch, for each
// aggregate the expectedVersion sequence must be contiguous (no gaps). Without
// this, [expectedVersion=0, expectedVersion=2] for the same aggregate would
// write v=1 and v=3 with v=2 missing — UNIQUE won't catch it (no collision),
// predecessor-EXISTS won't catch it (min is 0, check skipped), and the
// orphan only surfaces at projection-rebuild time. Fail-loud here instead.
function verifyContiguousWithinBatch(events: readonly RawEventToAppend[]): void {
  const byAggregate = new Map<string, RawEventToAppend[]>();
  for (const e of events) {
    const key = `${e.tenantId}:${e.aggregateId}`;
    const list = byAggregate.get(key) ?? [];
    list.push(e);
    byAggregate.set(key, list);
  }

  for (const list of byAggregate.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.expectedVersion - b.expectedVersion);
    const [first, ...rest] = sorted;
    if (!first) continue;
    let prev = first;
    for (const curr of rest) {
      if (curr.expectedVersion !== prev.expectedVersion + 1) {
        throw new VersionConflictError(curr.aggregateId, curr.expectedVersion);
      }
      prev = curr;
    }
  }
}

// Per aggregate-group, check the predecessor (min(expectedVersion) > 0)
// exists in the DB. For migration batches that are usually single-aggregate
// or fresh-stream, this loops zero or one times.
async function verifyPredecessors(
  runner: DbRunner,
  events: readonly RawEventToAppend[],
): Promise<void> {
  type GroupKey = { tenantId: TenantId; aggregateId: string; minExpected: number };
  const groups = new Map<string, GroupKey>();
  for (const e of events) {
    const key = `${e.tenantId}:${e.aggregateId}`;
    const existing = groups.get(key);
    if (!existing || e.expectedVersion < existing.minExpected) {
      groups.set(key, {
        tenantId: e.tenantId,
        aggregateId: e.aggregateId,
        minExpected: e.expectedVersion,
      });
    }
  }

  for (const g of groups.values()) {
    if (g.minExpected === 0) continue;
    const rows = (await asRawClient(runner).unsafe(
      `SELECT EXISTS(
         SELECT 1 FROM "kumiko_events"
         WHERE aggregate_id = $1::uuid
           AND tenant_id = $2::uuid
           AND version = $3
       ) AS present`,
      [g.aggregateId, g.tenantId, g.minExpected],
    )) as ReadonlyArray<{ present: boolean }>;
    if (!rows[0]?.present) {
      throw new VersionConflictError(g.aggregateId, g.minExpected);
    }
  }
}

// Single IN-query checks whether any (tenant, aggregate, newVersion) tuple
// already exists. Returns the first collision, so the thrown error names
// the real conflicting aggregate instead of the batch's first event.
async function verifyNoDuplicates(
  runner: DbRunner,
  events: readonly RawEventToAppend[],
): Promise<void> {
  const params: unknown[] = [];
  const tripleClauses = events.map((e) => {
    const baseIdx = params.length;
    params.push(e.tenantId, e.aggregateId, e.expectedVersion + 1);
    return `($${baseIdx + 1}::uuid, $${baseIdx + 2}::uuid, $${baseIdx + 3})`;
  });
  const rows = (await asRawClient(runner).unsafe(
    `SELECT aggregate_id, version FROM "kumiko_events"
     WHERE (tenant_id, aggregate_id, version) IN (${tripleClauses.join(", ")})
     LIMIT 1`,
    params,
  )) as ReadonlyArray<{ aggregate_id: string; version: number }>;
  const conflict = rows[0];
  if (conflict) {
    throw new VersionConflictError(conflict.aggregate_id, conflict.version - 1);
  }
}
