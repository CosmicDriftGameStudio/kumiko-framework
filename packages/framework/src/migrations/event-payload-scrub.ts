// Replaces chosen payload fields of stored events with PII_ERASED_SENTINEL and rebuilds the
// projections fed by them. For personal data that crypto-shredding cannot reach: plaintext from
// before the field was declared personal without a subject left to erase, or a ciphertext that no
// longer decrypts. A read-model UPDATE alone would come back with the next rebuild.

import { PII_ERASED_SENTINEL } from "../crypto/pii-field-encryption.ts";
import type { DbConnection, DbRunner } from "../db/connection.ts";
import { isLifecycleEventOf, lifecycleSections } from "../db/queries/backfill-pii.ts";
import {
  deleteSnapshotsOfAggregates,
  replaceEventPayload,
  type ScrubEventRow,
  selectEventsOfTypeAfter,
} from "../db/queries/event-store-payload-scrub.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import { withoutStatementTimeout } from "../db/statement-timeout.ts";
import { assertReason } from "../engine/escape-hatch-reason.ts";
import type { Registry } from "../engine/types/index.ts";
import type { Logger } from "../logging/types.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { createPendingRebuildsTable } from "./pending-rebuilds.ts";
import {
  affectedProjectionTables,
  ensureInfraTable,
  type PiiRebuildRun,
  queueRebuildTables,
  rebuildQueuedTables,
} from "./pii-event-backfill.ts";

const EVENT_SCRUB_MIGRATION_PREFIX = "event-scrub:";
const DEFAULT_BATCH_SIZE = 500;

export type EventScrubCandidate = {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: string;
  readonly field: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type ScrubEventPayloadOptions = {
  readonly eventType: string;
  readonly fields: readonly string[];
  // Why these values have to go; refused when it is a placeholder.
  readonly reason: string;
  // Narrows the scrub to matching values; without it every non-empty value of the fields goes (text fields get the placeholder, other fields become null).
  readonly shouldScrub?: (
    value: unknown,
    candidate: EventScrubCandidate,
  ) => boolean | Promise<boolean>;
  // Counts what would be scrubbed and writes nothing.
  readonly dryRun?: boolean;
  readonly batchSize?: number;
  readonly logger?: Pick<Logger, "error"> & Partial<Pick<Logger, "warn" | "info" | "debug">>;
};

export type ScrubEventPayloadResult = {
  readonly scannedEvents: number;
  readonly scrubbedEvents: number;
  readonly scrubbedFields: number;
  readonly deletedSnapshots: number;
  readonly queuedTables: readonly string[];
  readonly rebuild: PiiRebuildRun | null;
};

type Totals = {
  scannedEvents: number;
  scrubbedEvents: number;
  scrubbedFields: number;
  deletedSnapshots: number;
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== PII_ERASED_SENTINEL;
}

const TEXT_FIELD_TYPES: ReadonlySet<string> = new Set(["text", "longText"]);

// The sentinel is text; written into a typed projection column (integer, date, uuid, jsonb) it
// would fail every later rebuild of the table, and the event can no longer be repaired. So only
// text fields take it, other declared fields go null, and a required non-text field has no
// valid replacement. Fields the registry does not declare fall back to the value's own type.
function replacementFor(
  registry: Registry,
  aggregateType: string,
  field: string,
  value: unknown,
): string | null {
  const def = registry.getEntity(aggregateType)?.fields[field];
  if (def === undefined) return typeof value === "string" ? PII_ERASED_SENTINEL : null;
  if (TEXT_FIELD_TYPES.has(def.type)) return typeof value === "string" ? PII_ERASED_SENTINEL : null;
  if ("required" in def && def.required === true) {
    throw new Error(
      `scrubEventPayloadFields: "${aggregateType}.${field}" is a required ${def.type} field; ` +
        "it can neither hold the erase placeholder nor null, so its events cannot be scrubbed.",
    );
  }
  return null;
}

function assertLifecycleFieldsScrubbable(
  registry: Registry,
  eventType: string,
  fields: readonly string[],
): void {
  for (const [entityName] of registry.getAllEntities()) {
    if (!isLifecycleEventOf(eventType, entityName)) continue;
    for (const field of fields) replacementFor(registry, entityName, field, "");
  }
}

function payloadSections(
  row: ScrubEventRow,
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  return isLifecycleEventOf(row.type, row.aggregate_type) ? lifecycleSections(payload) : [payload];
}

async function scrubPayload(
  registry: Registry,
  row: ScrubEventRow,
  options: ScrubEventPayloadOptions,
): Promise<{ readonly payload: Record<string, unknown>; readonly scrubbed: number }> {
  const payload = structuredClone(row.payload);
  let scrubbed = 0;
  for (const section of payloadSections(row, payload)) {
    for (const field of options.fields) {
      const value = section[field];
      if (!hasValue(value)) continue;
      const candidate: EventScrubCandidate = {
        eventId: String(row.id),
        eventType: row.type,
        aggregateId: row.aggregate_id,
        aggregateType: row.aggregate_type,
        tenantId: row.tenant_id,
        field,
        payload: row.payload,
      };
      if (options.shouldScrub && !(await options.shouldScrub(value, candidate))) continue;
      section[field] = replacementFor(registry, row.aggregate_type, field, value);
      scrubbed++;
    }
  }
  return { payload, scrubbed };
}

// One transaction per batch: payloads, the snapshots that may cache the old values and the
// rebuild queue move together, so an abort leaves no scrubbed stream with a stale snapshot.
async function scrubOneBatch(
  db: DbConnection,
  registry: Registry,
  args: {
    readonly options: ScrubEventPayloadOptions;
    readonly afterEventId: string;
    readonly batchSize: number;
    readonly migrationId: string;
    readonly totals: Totals;
    readonly queuedTables: Set<string>;
  },
): Promise<{ readonly lastEventId: string | null; readonly scannedAll: boolean }> {
  const { options, totals } = args;
  return db.begin(async (tx: DbRunner) => {
    const rows = await selectEventsOfTypeAfter(
      tx,
      options.eventType,
      args.afterEventId,
      args.batchSize,
    );
    const last = rows[rows.length - 1];
    if (last === undefined) return { lastEventId: null, scannedAll: true };

    const touchedAggregates = new Set<string>();
    const touchedAggregateTypes = new Set<string>();
    for (const row of rows) {
      totals.scannedEvents++;
      const { payload, scrubbed } = await scrubPayload(registry, row, options);
      if (scrubbed === 0) continue;
      totals.scrubbedEvents++;
      totals.scrubbedFields += scrubbed;
      if (options.dryRun) continue;
      await replaceEventPayload(tx, row.id, payload);
      touchedAggregates.add(row.aggregate_id);
      touchedAggregateTypes.add(row.aggregate_type);
    }

    if (touchedAggregates.size > 0) {
      totals.deletedSnapshots += await deleteSnapshotsOfAggregates(tx, [...touchedAggregates]);
      const tables = affectedProjectionTables(
        registry,
        touchedAggregateTypes,
        new Set([options.eventType]),
      );
      await queueRebuildTables(tx, tables, args.migrationId);
      for (const table of tables) args.queuedTables.add(table);
    }
    return { lastEventId: String(last.id), scannedAll: rows.length < args.batchSize };
  });
}

async function scrubAllBatches(
  db: DbConnection,
  registry: Registry,
  options: ScrubEventPayloadOptions,
): Promise<ScrubEventPayloadResult> {
  const log = createFallbackLogger("event-payload-scrub", options.logger);
  if (!options.dryRun) {
    await ensureInfraTable(db, "kumiko_pending_rebuilds", createPendingRebuildsTable);
  }
  const migrationId = `${EVENT_SCRUB_MIGRATION_PREFIX}${crypto.randomUUID()}`;
  const totals: Totals = {
    scannedEvents: 0,
    scrubbedEvents: 0,
    scrubbedFields: 0,
    deletedSnapshots: 0,
  };
  const queuedTables = new Set<string>();
  let afterEventId = "0";
  for (;;) {
    const batch = await scrubOneBatch(db, registry, {
      options,
      afterEventId,
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      migrationId,
      totals,
      queuedTables,
    });
    if (batch.lastEventId === null) break;
    afterEventId = batch.lastEventId;
    if (batch.scannedAll) break;
  }

  const rebuild =
    queuedTables.size === 0
      ? null
      : await rebuildQueuedTables(db, registry, {
          migrationIdPrefix: migrationId,
          signal: undefined,
          log,
          failureMessage:
            "Projection rebuild after an event payload scrub failed; the tables stay queued in kumiko_pending_rebuilds",
        });
  // A real run is an audit trail of a destructive cross-tenant rewrite, so it must survive prod log levels.
  (options.dryRun ? log.debug : log.info)?.("Event payload scrub finished", {
    migrationId,
    dryRun: options.dryRun === true,
    eventType: options.eventType,
    fields: options.fields,
    reason: options.reason,
    ...totals,
  });
  return { ...totals, queuedTables: [...queuedTables], rebuild };
}

// Run it in a maintenance window without running writes on the affected event types: batches
// page by id (`"id" > afterEventId`) over committed rows, and bigserial ids are handed out before
// commit, so a parallel append whose id is below the cursor commits unseen and is skipped.
export function scrubEventPayloadFields(
  db: DbConnection,
  registry: Registry,
  options: ScrubEventPayloadOptions,
): Promise<ScrubEventPayloadResult> {
  assertReason("scrubEventPayloadFields", options.reason);
  if (options.fields.length === 0) {
    throw new Error("scrubEventPayloadFields: name at least one payload field to scrub");
  }
  assertLifecycleFieldsScrubbable(registry, options.eventType, options.fields);
  return runInSystemRowLevelSecurityScope(
    "event payload scrub rewrites one event type across all tenants",
    () =>
      withoutStatementTimeout(db, (unboundedDb) => scrubAllBatches(unboundedDb, registry, options)),
  );
}
