// Event-Store Admin-API — Marten-Bypass für Legacy-Daten-Importe.
//
// Prod-Readiness Welle 3, Step 3.1 — siehe
//   docs/plans/features/event-store-admin-api.md
//
// Schreibt Events direkt in die events-Tabelle, ohne Pipeline-Seiteneffekte:
// kein pg_notify, keine postSave-Hooks, keine Projections, kein SSE,
// kein Meilisearch, kein Audit-Log. Historische `createdAt` / `createdBy`
// werden vom Aufrufer übergeben — kein `now()`, kein userResolver.
//
// Versions-Check bleibt scharf:
//   - UNIQUE (tenant_id, aggregate_id, version) serialisiert
//   - Predecessor-EXISTS für expectedVersion > 0 (Gap-Schutz)
//
// Guard-Rail: dieses Modul ist NICHT aus event-store/index.ts re-exportiert.
// Import nur via deep-path `@kumiko/framework/event-store/admin-api`. Das
// Guard-Script `scripts/guard-admin-api.ts` blockt Calls aus App-Code; die
// Allowlist erlaubt Migration-Runner (samples/*/migration/, scripts/migrations/)
// und die Test-Datei dieses Moduls.

import { sql } from "drizzle-orm";
import type { DbRunner } from "../db";
import { isUniqueViolation } from "../db/pg-error";
import type { TenantId } from "../engine/types";
import { VersionConflictError } from "./errors";
import type { EventMetadata } from "./event-store";
import { eventsTable } from "./events-schema";

export type RawEventToAppend = {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: TenantId;
  // Predecessor version. 0 writes a new stream at version 1; > 0 requires the
  // predecessor to exist (same UUID, same tenant). Mirrors EventToAppend.
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

// Single raw append. Mirrors the append()-twopath-structure (typed builder
// for v=0, raw SQL with WHERE-EXISTS gate for v>0) so the version-check
// semantics stay identical to the normal path.
export async function appendRaw(runner: DbRunner, event: RawEventToAppend): Promise<void> {
  const newVersion = event.expectedVersion + 1;
  const eventVersion = event.eventVersion ?? 1;
  const createdAtIso = event.createdAt.toString();

  try {
    if (event.expectedVersion === 0) {
      await runner.execute(sql`
        INSERT INTO ${eventsTable} (
          aggregate_id, aggregate_type, tenant_id, version,
          type, event_version, payload, metadata, created_at, created_by
        )
        VALUES (
          ${event.aggregateId}::uuid,
          ${event.aggregateType},
          ${event.tenantId}::uuid,
          ${newVersion},
          ${event.type},
          ${eventVersion},
          ${JSON.stringify(event.payload)}::jsonb,
          ${JSON.stringify(event.metadata)}::jsonb,
          ${createdAtIso}::timestamptz,
          ${event.createdBy}
        )
      `);
    } else {
      // INSERT … SELECT … WHERE EXISTS — wenn der Predecessor fehlt,
      // liefert RETURNING keine Zeile und wir werfen manuell.
      const rows = await runner.execute<{ id: string }>(sql`
        INSERT INTO ${eventsTable} (
          aggregate_id, aggregate_type, tenant_id, version,
          type, event_version, payload, metadata, created_at, created_by
        )
        SELECT ${event.aggregateId}::uuid,
               ${event.aggregateType},
               ${event.tenantId}::uuid,
               ${newVersion},
               ${event.type},
               ${eventVersion},
               ${JSON.stringify(event.payload)}::jsonb,
               ${JSON.stringify(event.metadata)}::jsonb,
               ${createdAtIso}::timestamptz,
               ${event.createdBy}
        WHERE EXISTS (
          SELECT 1 FROM ${eventsTable}
          WHERE aggregate_id = ${event.aggregateId}::uuid
            AND version = ${event.expectedVersion}
            AND tenant_id = ${event.tenantId}::uuid
        )
        RETURNING id
      `);
      const arr = rows as unknown as Array<{ id: string }>;
      if (arr.length === 0) {
        throw new VersionConflictError(event.aggregateId, event.expectedVersion);
      }
    }
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new VersionConflictError(event.aggregateId, event.expectedVersion);
    }
    throw e;
  }
}

// Batch raw append. One multi-VALUES INSERT for the whole batch — atomic by
// virtue of PG statement-atomicity (any UNIQUE violation fails the whole
// statement, zero rows persisted).
//
// Per-row WHERE-EXISTS inside a multi-VALUES INSERT isn't expressible in SQL
// for in-flight versions (a v=2 event can't reference a v=1 sibling being
// inserted in the same statement — MVCC visibility rules). Instead we do a
// pre-flight predecessor check per aggregate-group: for each unique
// aggregate in the batch whose MIN(expectedVersion) > 0, the DB must
// already contain version=MIN. Sibling events within the batch are
// trusted to be version-contiguous by the caller — UNIQUE catches any
// accidental collision.
export async function appendRawBatch(
  runner: DbRunner,
  events: readonly RawEventToAppend[],
): Promise<void> {
  // skip: empty batch is a no-op by contract — callers that chunk a stream
  // into size-N batches shouldn't need to guard the tail-case themselves.
  if (events.length === 0) return;

  await verifyPredecessors(runner, events);

  const rows = events.map((e) => {
    const newVersion = e.expectedVersion + 1;
    const eventVersion = e.eventVersion ?? 1;
    const createdAtIso = e.createdAt.toString();
    return sql`(
      ${e.aggregateId}::uuid,
      ${e.aggregateType},
      ${e.tenantId}::uuid,
      ${newVersion},
      ${e.type},
      ${eventVersion},
      ${JSON.stringify(e.payload)}::jsonb,
      ${JSON.stringify(e.metadata)}::jsonb,
      ${createdAtIso}::timestamptz,
      ${e.createdBy}
    )`;
  });

  try {
    await runner.execute(sql`
      INSERT INTO ${eventsTable} (
        aggregate_id, aggregate_type, tenant_id, version,
        type, event_version, payload, metadata, created_at, created_by
      )
      VALUES ${sql.join(rows, sql`, `)}
    `);
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Multi-row UNIQUE violation doesn't tell us WHICH tuple collided.
      // Report against the first event in the batch — callers with mixed
      // batches can inspect the DB for the actual conflict.
      const first = events[0]!;
      throw new VersionConflictError(first.aggregateId, first.expectedVersion);
    }
    throw e;
  }
}

// Group by (tenantId, aggregateId), find min(expectedVersion) per group.
// For groups where min > 0, the predecessor must already exist in the DB.
// One SELECT per group with min>0 — for migration batches that are usually
// single-aggregate or fresh-stream, this loops zero or one times.
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
    const rows = await runner.execute<{ present: boolean }>(sql`
      SELECT EXISTS(
        SELECT 1 FROM ${eventsTable}
        WHERE aggregate_id = ${g.aggregateId}::uuid
          AND tenant_id = ${g.tenantId}::uuid
          AND version = ${g.minExpected}
      ) AS present
    `);
    const arr = rows as unknown as Array<{ present: boolean }>;
    if (!arr[0]?.present) {
      throw new VersionConflictError(g.aggregateId, g.minExpected);
    }
  }
}
