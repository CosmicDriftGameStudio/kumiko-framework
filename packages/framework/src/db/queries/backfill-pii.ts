// One-time backfill for pre-KMS plaintext PII in kumiko_events.
//
// Crypto-shredding only covers NEW writes — events appended
// before a KMS was configured still carry plaintext (user.created email,
// delivery attempt recipientAddress, job payloads). This tool re-encrypts
// them in place, per field, under the owning subject's DEK:
//
//   - entity lifecycle events (<entity>.created/updated/deleted/forgotten/
//     restored) for every entity with PII subject annotations — generic over
//     subject kind (user/tenant/record), since it goes through the
//     same collectPiiEncryptedFields/resolveSubjectForField the live write
//     path uses
//   - custom events from the event-PII catalog (r.defineEvent piiFields) —
//     user/tenant/self subjects, via the same resolveEventSubject the live
//     append path uses
//
// Already-forgotten subjects must NOT get a fresh key minted for their old
// plaintext — three erased-detection layers write [[erased]] instead:
//   1. KeyErasedError from the KMS (subject forgotten in the KMS era)
//   2. the event's own aggregate has a *.forgotten event (pre-KMS forget)
//   3. the resolved user subject's id has a *.forgotten event (custom
//      events referencing a pre-KMS-forgotten user)
//
// Idempotent: ciphertext and sentinel values pass through untouched — a
// second run reports 0 updates. One failing event does not abort the run;
// failures are collected and reported (fail-loud at the caller).
//
// Owner resolution for entity-lifecycle events. The live write path
// (event-store-executor-write.ts) resolves the same chain via
// subject-resolver.ts: row owner, then the owner the same event sets, then
// the field's whenAbsent. Backfill adds two opt-in stages and
// delays whenAbsent behind the projection so a known owner is never shadowed:
//   1. payload — the event section (plus the owner the same event sets) names
//      the owner field; whenAbsent is not applied yet.
//   2. projection ({@link PiiBackfillOptions.resolveOwnerFromProjection}) —
//      pre-owner-field-addition events don't carry it; read it from the
//      entity's current projection row instead.
//      A hard-deleted aggregate falls back to the row stored in its delete event.
//   2b. whenAbsent — the payload again, now falling back to the tenant key (or
//      the row's own record key for whenAbsent: "self") for fields that declare it.
//   3. erase ({@link PiiBackfillOptions.eraseUnresolvableSubjects}) — still
//      unresolvable (hard-deleted aggregate, no projection) → PII_ERASED_SENTINEL.
//   Stages 2 and 3 are opt-in and off by default; without them an
//   unresolvable subject still fails loud into `failures`, as before.
//   4. owner re-key ({@link PiiBackfillOptions.rekeyTenantKeyedOwnerFields}) —
//   tenant-keyed ciphertext of a userOwned field moves under the user the
//   strict chain (stages 1+2, never whenAbsent) names; user-keyed ciphertext
//   moves under the projection's current owner when that is another user (an
//   owner change made before owner transitions re-keyed the value). Only the latest
//   event that carries the field moves: older events were written for the previous
//   owner, and a newer event means the live path already re-keyed the value, so a
//   forget of the previous owner must keep erasing the older ones. An owner
//   cleared again (owner → none) is not recoverable from the projection: such
//   values stay tenant-keyed, unlike the live path that keeps the last owner.
//   For whenAbsent: "self" fields the same stage moves tenant-keyed ciphertext
//   of a still-ownerless row under its record key (written before the field
//   declared "self"); a later owner assignment keeps the created event
//   record-keyed, like the tenant-keyed case.
//
// Snapshots of touched aggregates are dropped per batch (they may cache
// plaintext); the next snapshotting load recreates them. AFTER a run, rebuild the
// affected projections — applyEntityEvent materializes ciphertext AND the
// blind-index columns, which keeps equality lookups (login by email) alive.

import { type EntityDefinition, isDeclaredEntityVerb } from "@cosmicdrift/kumiko-types/fields";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { configuredEventPiiCatalog } from "../../crypto/event-pii.ts";
import {
  isLocalKeyKmsAdapter,
  KeyErasedError,
  KeyNotFoundError,
  type KmsContext,
  type LocalKeyKmsAdapter,
  type SubjectId,
} from "../../crypto/kms-adapter.ts";
import { isPlainUserOwnedField } from "../../crypto/owner-transition-rekey.ts";
import {
  configuredPiiSubjectKms,
  decryptPiiValueForSubject,
  encryptPiiJsonValueForSubject,
  encryptPiiValueForSubject,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
  piiCiphertextSubject,
} from "../../crypto/pii-field-encryption.ts";
import {
  collectPiiEncryptedFields,
  resolveEventSubject,
  SubjectResolutionError,
  usableOwnerId,
} from "../../crypto/subject-resolver.ts";
import type { Registry, TenantId } from "../../engine/types/index.ts";
import type { DbRunner } from "../connection.ts";
import { resolveTableName } from "../entity-table-meta.ts";
import { entityEventName } from "../event-store-executor-context.ts";
import { asRawClient } from "../query.ts";
import { tableExists } from "../schema-inspection.ts";
import { quoteIdent } from "../sql-identifier.ts";
import { withoutStatementTimeout } from "../statement-timeout.ts";
import { projectionRowToCamel, resolveOwnerSubject } from "./backfill-pii-owner-resolution.ts";
import { toPostgresArrayLiteral } from "./postgres-array-literal.ts";

const LIFECYCLE_VERBS = ["created", "updated", "deleted", "restored", "forgotten"] as const;

export type PiiBackfillFailure = {
  readonly eventId: string;
  readonly reason: string;
};

export type PiiBackfillResult = {
  readonly scannedEvents: number;
  readonly updatedEvents: number;
  readonly encryptedFields: number;
  readonly erasedFields: number;
  // Tenant-keyed personal fields moved under their owner's key (stage 4).
  readonly rekeyedFields: number;
  // Subset of encryptedFields + erasedFields whose owner came from stage 2
  // (the payload itself lacked it).
  readonly ownerFromProjection: number;
  // Subset of erasedFields written because the subject stayed unresolvable
  // through stage 3, not because the subject was already forgotten.
  readonly erasedUnresolvable: number;
  readonly deletedSnapshots: number;
  readonly failures: readonly PiiBackfillFailure[];
};

export type PiiBackfillScanCache = {
  forgottenAggregates?: ReadonlySet<string>;
  destroyedTenants?: ReadonlySet<string>;
};

export type PiiBackfillBatchResult = PiiBackfillResult & {
  // Last scanned event id; null when the batch was empty.
  readonly lastEventId: string | null;
  readonly scannedAll: boolean;
  readonly firstFailedEventId: string | null;
  readonly touchedAggregateTypes: readonly string[];
  readonly touchedEventTypes: readonly string[];
};

export type PiiBackfillOptions = {
  readonly batchSize?: number;
  // Scan + count only, write nothing — including the subject KMS: outcomes
  // are predicted from a read-only kms.getKey probe, never kms.createKey.
  readonly dryRun?: boolean;
  // Stage 2: fall back to the entity's projection row (by aggregate_id)
  // when a lifecycle event's payload doesn't name the owner field.
  readonly resolveOwnerFromProjection?: boolean;
  // Stage 3: write PII_ERASED_SENTINEL for subjects still unresolvable
  // after stage 1+2, instead of failing the event into `failures`.
  readonly eraseUnresolvableSubjects?: boolean;
  // Stage 4: a personal field written while the row had no owner is tenant-keyed
  // forever in the immutable log; once the owner is known, only its own key
  // makes the owner's forget erase the value. Off by default: it decrypts and
  // re-encrypts already-encrypted values.
  readonly rekeyTenantKeyedOwnerFields?: boolean;
};

export type PiiBackfillBatchOptions = PiiBackfillOptions & {
  readonly afterEventId?: bigint | string;
  // Re-scan exactly these events instead of the range after `afterEventId`.
  readonly eventIds?: readonly string[];
  // Caller-held so the forgotten-set full scan is shared across batches.
  readonly scanCache?: PiiBackfillScanCache;
};

type EventRow = {
  readonly id: bigint | string;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly tenant_id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

type FieldOutcome = "unchanged" | "encrypted" | "erased";

type PiiTargets = {
  readonly entityTargets: ReadonlyMap<
    string,
    { readonly entity: EntityDefinition; readonly piiFields: readonly string[] }
  >;
  readonly eventCatalog: ReturnType<typeof configuredEventPiiCatalog>;
};

function collectPiiTargets(registry: Registry): PiiTargets {
  const entityTargets = new Map<
    string,
    { readonly entity: EntityDefinition; readonly piiFields: readonly string[] }
  >();
  for (const [name, entity] of registry.getAllEntities()) {
    const piiFields = collectPiiEncryptedFields(entity);
    if (piiFields.length > 0) entityTargets.set(name, { entity, piiFields });
  }
  return { entityTargets, eventCatalog: configuredEventPiiCatalog() };
}

function requireLocalKeySubjectKms(caller: string): LocalKeyKmsAdapter {
  const kms = configuredPiiSubjectKms();
  if (!kms) {
    throw new Error(
      `${caller} requires a configured subject KMS — boot with ` +
        "runProdApp({ kms }) / configurePiiSubjectKms(adapter) before running the backfill.",
    );
  }
  if (!isLocalKeyKmsAdapter(kms)) {
    throw new Error(`${caller} requires a local-key KMS adapter`);
  }
  return kms;
}

export function backfillEventPiiEncryption(
  db: DbRunner,
  registry: Registry,
  options: PiiBackfillOptions = {},
): Promise<PiiBackfillResult> {
  return withoutStatementTimeout(db, (unboundedDb) =>
    backfillAllEventBatches(unboundedDb, registry, options),
  );
}

async function backfillAllEventBatches(
  db: DbRunner,
  registry: Registry,
  options: PiiBackfillOptions,
): Promise<PiiBackfillResult> {
  requireLocalKeySubjectKms("backfillEventPiiEncryption");
  const total = {
    scannedEvents: 0,
    updatedEvents: 0,
    encryptedFields: 0,
    erasedFields: 0,
    rekeyedFields: 0,
    ownerFromProjection: 0,
    erasedUnresolvable: 0,
    deletedSnapshots: 0,
  };
  const failures: PiiBackfillFailure[] = [];
  const scanCache: PiiBackfillScanCache = {};
  let afterEventId: string = "0";

  for (;;) {
    const batch = await backfillEventPiiEncryptionBatch(db, registry, {
      ...options,
      afterEventId,
      scanCache,
    });
    total.scannedEvents += batch.scannedEvents;
    total.updatedEvents += batch.updatedEvents;
    total.encryptedFields += batch.encryptedFields;
    total.erasedFields += batch.erasedFields;
    total.rekeyedFields += batch.rekeyedFields;
    total.ownerFromProjection += batch.ownerFromProjection;
    total.erasedUnresolvable += batch.erasedUnresolvable;
    total.deletedSnapshots += batch.deletedSnapshots;
    failures.push(...batch.failures);
    if (batch.lastEventId === null || batch.scannedAll) break;
    afterEventId = batch.lastEventId;
  }
  return { ...total, failures };
}

function failureReason(e: unknown): string {
  const reason = e instanceof Error ? e.message : String(e);
  if (!(e instanceof SubjectResolutionError)) return reason;
  return (
    `${reason} (retry with { resolveOwnerFromProjection: true } to resolve the owner ` +
    "from the entity's projection table, and/or { eraseUnresolvableSubjects: true } to " +
    "erase fields whose subject stays unresolvable)"
  );
}

function selectEventBatch(
  raw: ReturnType<typeof asRawClient>,
  aggregateTypes: readonly string[],
  catalogTypes: readonly string[],
  options: PiiBackfillBatchOptions,
  batchSize: number,
): Promise<readonly EventRow[]> {
  if (options.eventIds) {
    return raw.unsafe<EventRow>(
      `SELECT "id", "aggregate_id", "aggregate_type", "tenant_id", "type", "payload"
           FROM "kumiko_events"
          WHERE ("aggregate_type" = ANY($1::text[]) OR "type" = ANY($2::text[])) AND "id" = ANY($3::bigint[])
          ORDER BY "id" ASC`,
      [
        toPostgresArrayLiteral(aggregateTypes),
        toPostgresArrayLiteral(catalogTypes),
        toPostgresArrayLiteral([...options.eventIds]),
      ],
    );
  }
  return raw.unsafe<EventRow>(
    `SELECT "id", "aggregate_id", "aggregate_type", "tenant_id", "type", "payload"
           FROM "kumiko_events"
          WHERE ("aggregate_type" = ANY($1::text[]) OR "type" = ANY($2::text[])) AND "id" > $3::bigint
          ORDER BY "id" ASC
          LIMIT $4`,
    [
      toPostgresArrayLiteral(aggregateTypes),
      toPostgresArrayLiteral(catalogTypes),
      String(options.afterEventId ?? 0),
      batchSize,
    ],
  );
}

// Processes exactly one batch. Snapshots of the batch's touched aggregates are
// dropped inside the same call so an abort between batches never leaves a
// snapshot that caches plaintext for an already-encrypted stream.
export async function backfillEventPiiEncryptionBatch(
  db: DbRunner,
  registry: Registry,
  options: PiiBackfillBatchOptions = {},
): Promise<PiiBackfillBatchResult> {
  const subjectKms = requireLocalKeySubjectKms("backfillEventPiiEncryptionBatch");
  const batchSize = options.batchSize ?? 500;
  const raw = asRawClient(db);
  const kmsCtx: KmsContext = { requestId: "pii-backfill" };
  const scanCache = options.scanCache ?? {};

  const { entityTargets, eventCatalog } = collectPiiTargets(registry);
  const scope: BackfillBatchScope = {
    db,
    raw,
    options,
    subjectKms,
    kmsCtx,
    scanCache,
    entityTargets,
    eventCatalog,
  };
  const aggregateTypes = [...entityTargets.keys()];
  const catalogTypes = [...eventCatalog.keys()];
  const failures: PiiBackfillFailure[] = [];
  const result = {
    scannedEvents: 0,
    updatedEvents: 0,
    encryptedFields: 0,
    erasedFields: 0,
    rekeyedFields: 0,
    ownerFromProjection: 0,
    erasedUnresolvable: 0,
    deletedSnapshots: 0,
    failures,
  };
  const emptyBatch = (): PiiBackfillBatchResult => ({
    ...result,
    lastEventId: null,
    scannedAll: true,
    firstFailedEventId: null,
    touchedAggregateTypes: [],
    touchedEventTypes: [],
  });
  if (aggregateTypes.length === 0 && catalogTypes.length === 0) return emptyBatch();

  const rows = await selectEventBatch(raw, aggregateTypes, catalogTypes, options, batchSize);
  const last = rows[rows.length - 1];
  if (last === undefined) return emptyBatch();

  const projectionOwnersByType = await loadProjectionOwners(scope, rows);
  const streamHistories = await loadUpdatedStreamHistories(scope, rows);
  const touchedAggregates = new Set<string>();
  const touchedAggregateTypes = new Set<string>();
  const touchedEventTypes = new Set<string>();
  let firstFailedEventId: string | null = null;

  for (const row of rows) {
    result.scannedEvents++;
    try {
      const outcome = await transformEvent(
        scope,
        row,
        projectionOwnersByType.get(row.aggregate_type),
        streamHistories.get(streamHistoryKey(row.tenant_id, row.aggregate_id)),
      );
      if (outcome === null) continue;
      result.encryptedFields += outcome.encrypted;
      result.erasedFields += outcome.erased;
      result.rekeyedFields += outcome.rekeyed;
      result.ownerFromProjection += outcome.ownerFromProjection;
      result.erasedUnresolvable += outcome.erasedUnresolvable;
      if (!options.dryRun) {
        await raw.unsafe(`UPDATE "kumiko_events" SET "payload" = $1::jsonb WHERE "id" = $2`, [
          outcome.payload,
          row.id,
        ]);
      }
      result.updatedEvents++;
      touchedAggregates.add(row.aggregate_id);
      touchedAggregateTypes.add(row.aggregate_type);
      touchedEventTypes.add(row.type);
    } catch (e) {
      firstFailedEventId ??= String(row.id);
      result.failures.push({ eventId: String(row.id), reason: failureReason(e) });
    }
  }

  // Snapshots may cache the plaintext state of touched aggregates.
  if (!options.dryRun && touchedAggregates.size > 0) {
    const deleted = await raw.unsafe(
      `DELETE FROM "kumiko_snapshots" WHERE "aggregate_id" = ANY($1::uuid[]) RETURNING "aggregate_id"`,
      [toPostgresArrayLiteral([...touchedAggregates])],
    );
    result.deletedSnapshots = deleted.length;
  }

  return {
    ...result,
    lastEventId: String(last.id),
    scannedAll: options.eventIds !== undefined || rows.length < batchSize,
    firstFailedEventId,
    touchedAggregateTypes: [...touchedAggregateTypes],
    touchedEventTypes: [...touchedEventTypes],
  };
}

type BackfillBatchScope = {
  readonly db: DbRunner;
  readonly raw: ReturnType<typeof asRawClient>;
  readonly options: PiiBackfillBatchOptions;
  readonly subjectKms: LocalKeyKmsAdapter;
  readonly kmsCtx: KmsContext;
  readonly scanCache: PiiBackfillScanCache;
  readonly entityTargets: PiiTargets["entityTargets"];
  readonly eventCatalog: PiiTargets["eventCatalog"];
};

type EventFieldCounters = {
  encrypted: number;
  erased: number;
  rekeyed: number;
  ownerFromProjection: number;
  erasedUnresolvable: number;
};

type EventTransformScope = {
  readonly batch: BackfillBatchScope;
  readonly row: EventRow;
  readonly tenantId: TenantId;
  readonly payload: Record<string, unknown>;
  readonly counters: EventFieldCounters;
};

// Full-scan of the store — only paid once a plaintext field actually needs
// encrypting, so a catch-up run over already-encrypted events never runs it.
async function loadForgottenAggregates(scope: BackfillBatchScope): Promise<ReadonlySet<string>> {
  const { raw, scanCache } = scope;
  if (scanCache.forgottenAggregates) return scanCache.forgottenAggregates;
  // Pre-KMS forgets left no key tombstone — the *.forgotten event on the
  // stream is the only durable marker. aggregate_id doubles as the user id
  // for user-subject lookups.
  const forgottenRows = await raw.unsafe<{ aggregate_id: string }>(
    `SELECT DISTINCT "aggregate_id" FROM "kumiko_events" WHERE "type" LIKE '%.forgotten'`,
  );
  scanCache.forgottenAggregates = new Set(forgottenRows.map((r) => r.aggregate_id));
  return scanCache.forgottenAggregates;
}

async function loadProjectionOwners(
  scope: BackfillBatchScope,
  rows: readonly EventRow[],
): Promise<ReadonlyMap<string, ReadonlyMap<string, ProjectionOwner>>> {
  const { db, raw, options, entityTargets } = scope;
  const byType = new Map<string, ReadonlyMap<string, ProjectionOwner>>();
  if (!options.resolveOwnerFromProjection) return byType;

  const idsByType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!entityTargets.has(row.aggregate_type)) continue;
    const ids = idsByType.get(row.aggregate_type) ?? new Set<string>();
    ids.add(row.aggregate_id);
    idsByType.set(row.aggregate_type, ids);
  }

  for (const [aggregateType, ids] of idsByType) {
    const target = entityTargets.get(aggregateType);
    if (!target) continue;
    const tableName = resolveTableName(aggregateType, target.entity, undefined);
    const ownersById = new Map<string, ProjectionOwner>();
    // Existence check instead of catching undefined_table: a caught SQL error
    // aborts the surrounding transaction (25P02). Entity never mounted/rebuilt
    // → stage 3 still gets a chance; this batch just contributes no owners.
    if (await tableExists(db, `public.${tableName}`)) {
      const projectionRows = await raw.unsafe<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdent(tableName)} WHERE "id" = ANY($1::uuid[])`,
        [toPostgresArrayLiteral([...ids])],
      );
      for (const projectionRow of projectionRows) {
        const id = projectionRow["id"];
        if (typeof id === "string") {
          const rowTenantId = projectionRow["tenant_id"];
          ownersById.set(id, {
            tenantId: typeof rowTenantId === "string" ? rowTenantId : undefined,
            fields: projectionRowToCamel(target.entity, projectionRow),
          });
        }
      }
    }
    const missingIds = [...ids].filter((id) => !ownersById.has(id));
    if (missingIds.length > 0) {
      const deleteRows = await raw.unsafe<{
        aggregate_id: string;
        tenant_id: string | null;
        previous: unknown;
      }>(
        `SELECT DISTINCT ON ("aggregate_id") "aggregate_id", "tenant_id", "payload" -> 'previous' AS "previous" FROM "kumiko_events" WHERE "aggregate_type" = $1 AND "type" = $2 AND "aggregate_id" = ANY($3::uuid[]) ORDER BY "aggregate_id", "id" DESC`,
        [
          aggregateType,
          entityEventName(aggregateType, "deleted"),
          toPostgresArrayLiteral(missingIds),
        ],
      );
      for (const deleteRow of deleteRows) {
        if (!isRecord(deleteRow.previous)) continue;
        ownersById.set(deleteRow.aggregate_id, {
          tenantId: deleteRow.tenant_id ?? undefined,
          fields: deleteRow.previous,
        });
      }
    }
    byType.set(aggregateType, ownersById);
  }
  return byType;
}

type StreamHistoryEvent = Pick<EventRow, "id" | "aggregate_id" | "tenant_id" | "type" | "payload">;

function streamHistoryKey(tenantId: string, aggregateId: string): string {
  return `${tenantId}:${aggregateId}`;
}

// The streams of the batch's update events, up to the batch's last event. An update's previous
// carries only the changed keys, so the owner of an older value must come from the stream folded
// up to that event; the projection row only knows today's owner.
async function loadUpdatedStreamHistories(
  scope: BackfillBatchScope,
  rows: readonly EventRow[],
): Promise<ReadonlyMap<string, readonly StreamHistoryEvent[]>> {
  const idsByType = new Map<string, Set<string>>();
  let lastEventId = 0n;
  for (const row of rows) {
    if (!scope.entityTargets.has(row.aggregate_type) || !isRecord(row.payload["changes"])) continue;
    const ids = idsByType.get(row.aggregate_type) ?? new Set<string>();
    ids.add(row.aggregate_id);
    idsByType.set(row.aggregate_type, ids);
    const rowId = BigInt(row.id);
    if (rowId > lastEventId) lastEventId = rowId;
  }
  const histories = new Map<string, StreamHistoryEvent[]>();
  for (const [aggregateType, ids] of idsByType) {
    const events = await scope.raw.unsafe<StreamHistoryEvent>(
      `SELECT "id", "aggregate_id", "tenant_id", "type", "payload" FROM "kumiko_events" WHERE "aggregate_type" = $1 AND "aggregate_id" = ANY($2::uuid[]) AND "id" <= $3::bigint ORDER BY "id" ASC`,
      [aggregateType, toPostgresArrayLiteral([...ids]), String(lastEventId)],
    );
    for (const event of events) {
      const key = streamHistoryKey(event.tenant_id, event.aggregate_id);
      const history = histories.get(key) ?? [];
      history.push(event);
      histories.set(key, history);
    }
  }
  return histories;
}

// The row as the stream had it right before `row`: created sets the fields, every later
// lifecycle event with changes overlays them.
function streamStateBefore(
  history: readonly StreamHistoryEvent[] | undefined,
  row: EventRow,
  entity: EntityDefinition,
): Record<string, unknown> {
  const createdType = entityEventName(row.aggregate_type, "created");
  const rowId = BigInt(row.id);
  let state: Record<string, unknown> = {};
  for (const event of history ?? []) {
    if (BigInt(event.id) >= rowId) break;
    if (!isLifecycleEventOf(event.type, row.aggregate_type, entity)) continue;
    const changes = event.payload["changes"];
    if (event.type === createdType) state = { ...event.payload };
    else if (isRecord(changes)) state = { ...state, ...changes };
  }
  return state;
}

async function transformEvent(
  scope: BackfillBatchScope,
  row: EventRow,
  projectionOwners: ReadonlyMap<string, ProjectionOwner> | undefined,
  streamHistory: readonly StreamHistoryEvent[] | undefined,
): Promise<{
  payload: Record<string, unknown>;
  encrypted: number;
  erased: number;
  rekeyed: number;
  ownerFromProjection: number;
  erasedUnresolvable: number;
} | null> {
  const counters: EventFieldCounters = {
    encrypted: 0,
    erased: 0,
    rekeyed: 0,
    ownerFromProjection: 0,
    erasedUnresolvable: 0,
  };
  const payload = structuredClone(row.payload);
  const tenantId: TenantId = row.tenant_id;
  const eventScope: EventTransformScope = { batch: scope, row, tenantId, payload, counters };

  const catalogFields = scope.eventCatalog.get(row.type);
  if (catalogFields) {
    for (const [field, spec] of Object.entries(catalogFields)) {
      let subject: ReturnType<typeof resolveEventSubject>;
      try {
        subject = resolveEventSubject(field, spec, payload, {
          tenantId,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
        });
      } catch (e) {
        // Re-thrown as a plain Error: the owner-resolution retry hint added for
        // SubjectResolutionError only applies to entity events.
        if (!(e instanceof SubjectResolutionError)) throw e;
        throw new Error(
          `catalog event subject unresolvable: ${e.message} (fix aggregate_type/tenant_id or the piiFields declaration)`,
        );
      }
      if (subject === null) continue;
      const outcome = await encryptField(eventScope, payload, field, subject);
      bump(counters, outcome);
    }
  } else {
    const target = scope.entityTargets.get(row.aggregate_type);
    if (!target || !isLifecycleEventOf(row.type, row.aggregate_type, target.entity)) return null;
    const ownerRow = projectionOwnerRowOfTenant(
      projectionOwners?.get(row.aggregate_id),
      row.tenant_id,
    );
    await applyEntityLifecycleFields(
      eventScope,
      target,
      ownerRow,
      streamStateBefore(streamHistory, row, target.entity),
    );
  }

  if (counters.encrypted === 0 && counters.erased === 0 && counters.rekeyed === 0) return null;
  return { payload, ...counters };
}

function bump(counters: EventFieldCounters, outcome: FieldOutcome): void {
  if (outcome === "encrypted") counters.encrypted++;
  if (outcome === "erased") counters.erased++;
}

async function applyEntityLifecycleFields(
  scope: EventTransformScope,
  target: { readonly entity: EntityDefinition; readonly piiFields: readonly string[] },
  projectionOwnerRow: Record<string, unknown> | undefined,
  stateBefore: Record<string, unknown>,
): Promise<void> {
  const { batch, row, tenantId, payload, counters } = scope;
  const { options } = batch;
  const sections = lifecycleSections(payload);
  for (const section of sections) {
    const { subjectSource, ownerFallback } = lifecycleSubjectView(
      section,
      payload,
      row.aggregate_id,
      stateBefore,
    );
    for (const field of target.piiFields) {
      const value = section[field];
      if (value === null || value === undefined) continue;
      // A jsonb field holds any JSON value; a string that is neither ciphertext nor the
      // sentinel is a plaintext scalar and gets the JSON format (the v2 text format must
      // not reach a jsonb column).
      const isJsonbField = target.entity.fields[field]?.type === "jsonb";
      if (!isJsonbField && typeof value !== "string") continue;
      // Already-ciphertext/sentinel fields must never enter the encrypt/erase
      // owner resolution — an unresolvable owner on an already-handled field
      // must stay untouched, not get erased by stage 3.
      if (isPiiCiphertext(value)) {
        if (options.rekeyTenantKeyedOwnerFields) {
          await rekeyField(
            scope,
            target.entity,
            section,
            field,
            value,
            subjectSource,
            ownerFallback,
            projectionOwnerRow,
          );
        }
        continue;
      }
      if (value === PII_ERASED_SENTINEL) continue;

      const resolution = resolveOwnerSubject(
        target.entity,
        field,
        subjectSource,
        ownerFallback,
        projectionOwnerRow,
        tenantId,
        row.aggregate_type,
      );
      if (resolution.kind === "unannotated") continue;
      if (resolution.kind === "unresolved") {
        if (options.eraseUnresolvableSubjects) {
          section[field] = PII_ERASED_SENTINEL;
          counters.erased++;
          counters.erasedUnresolvable++;
          continue;
        }
        throw resolution.error;
      }
      if (resolution.viaProjection) counters.ownerFromProjection++;
      const outcome = await encryptField(scope, section, field, resolution.subject, isJsonbField);
      bump(counters, outcome);
    }
  }
}

async function rekeyField(
  scope: EventTransformScope,
  entity: EntityDefinition,
  section: Record<string, unknown>,
  field: string,
  ciphertext: string,
  subjectSource: Record<string, unknown>,
  ownerFallback: Record<string, unknown> | undefined,
  projectionOwnerRow: Record<string, unknown> | undefined,
): Promise<void> {
  const { batch, row, tenantId, payload, counters } = scope;
  const rekey = await rekeyTenantKeyedValue(
    {
      subjectKms: batch.subjectKms,
      kmsCtx: batch.kmsCtx,
      dryRun: batch.options.dryRun === true,
      isForgottenSubject: (subject) => isForgottenSubject(batch, subject, row.aggregate_id),
      hasNewerValueOfField: (fieldName) => aggregateHasNewerValueOfField(batch, row, fieldName),
      predictOutcome: (subject) => predictEncryptOutcome(batch, subject),
    },
    {
      entity,
      field,
      ciphertext,
      tenantId,
      aggregateType: row.aggregate_type,
      subjectSource,
      ownerFallback,
      projectionOwnerRow,
      isSupersededHistory: section === payload["previous"] && isRecord(payload["changes"]),
    },
  );
  if (rekey.kind === "rekeyed") {
    section[field] = rekey.value;
    counters.rekeyed++;
  } else if (rekey.kind === "erased") {
    section[field] = PII_ERASED_SENTINEL;
    counters.erased++;
  }
}

async function encryptField(
  scope: EventTransformScope,
  section: Record<string, unknown>,
  field: string,
  subject: SubjectId,
  isJsonbField = false,
): Promise<FieldOutcome> {
  const { batch, row } = scope;
  const value = section[field];
  if (value === null || value === undefined) return "unchanged";
  if (!isBackfillCandidate(value, isJsonbField)) return "unchanged";
  if (await isForgottenSubject(batch, subject, row.aggregate_id)) {
    section[field] = PII_ERASED_SENTINEL;
    return "erased";
  }
  if (batch.options.dryRun) return predictEncryptOutcome(batch, subject);
  try {
    section[field] = await encryptBackfillValue(
      batch.subjectKms,
      subject,
      value,
      batch.kmsCtx,
      field,
      isJsonbField,
    );
    return "encrypted";
  } catch (e) {
    if (e instanceof KeyErasedError) {
      section[field] = PII_ERASED_SENTINEL;
      return "erased";
    }
    throw e;
  }
}

// getKey alone never mints (unlike getOrCreateDek → createKey on the real
// path) — a real run's outcome is fully determined by whether a key
// already exists, so probing it read-only predicts the outcome without
// writing to the subject-keys store.
async function predictEncryptOutcome(
  scope: BackfillBatchScope,
  subject: SubjectId,
): Promise<FieldOutcome> {
  try {
    await scope.subjectKms.getKey(subject, scope.kmsCtx);
    return "encrypted";
  } catch (e) {
    if (e instanceof KeyErasedError) return "erased";
    if (e instanceof KeyNotFoundError) return "encrypted";
    throw e;
  }
}

async function isForgottenSubject(
  scope: BackfillBatchScope,
  subject: SubjectId,
  aggregateId: string,
): Promise<boolean> {
  const forgottenAggregates = await loadForgottenAggregates(scope);
  if (forgottenAggregates.has(aggregateId)) return true;
  if (subject.kind === "record" && subject.entity === "tenant") {
    return (await loadDestroyedTenants(scope)).has(subject.id);
  }
  return subject.kind === "user" && forgottenAggregates.has(subject.userId);
}

// A later event that sets the field (`changes`, or the flat payload of a created event). An
// explicit null counts: it replaced the value this event carries, so that value is stale.
async function aggregateHasNewerValueOfField(
  scope: BackfillBatchScope,
  event: EventRow,
  fieldName: string,
): Promise<boolean> {
  const rows = await scope.raw.unsafe<{ found: number }>(
    `SELECT 1 AS found FROM "kumiko_events"
        WHERE "aggregate_id" = $1 AND "tenant_id" = $2 AND "id" > $3::bigint
          AND (
            jsonb_exists("payload" -> 'changes', $4::text)
            OR ("payload" -> 'changes' IS NULL AND "payload" -> 'previous' IS NULL
                AND jsonb_exists("payload", $4::text))
          )
        LIMIT 1`,
    [event.aggregate_id, event.tenant_id, event.id, fieldName],
  );
  return rows.length > 0;
}

// A tenant destroyed before its name was record-owned never had a record key
// to erase, and destroy tombstones the row instead of emitting *.forgotten —
// read_tenants.destroyed_at is the only durable marker.
async function loadDestroyedTenants(scope: BackfillBatchScope): Promise<ReadonlySet<string>> {
  const { raw, scanCache } = scope;
  if (scanCache.destroyedTenants) return scanCache.destroyedTenants;
  const rows = await raw.unsafe<{ id: string }>(
    `SELECT id::text AS id FROM read_tenants WHERE destroyed_at IS NOT NULL`,
  );
  scanCache.destroyedTenants = new Set(rows.map((r) => r.id));
  return scanCache.destroyedTenants;
}

// Text fields only hold strings; a jsonb field holds any JSON value, scalars included.
// Ciphertext and the erased sentinel are already handled.
function isBackfillCandidate(value: unknown, isJsonbField: boolean): boolean {
  if (typeof value === "string") return !isPiiCiphertext(value) && value !== PII_ERASED_SENTINEL;
  return isJsonbField || (typeof value === "object" && value !== null);
}

function encryptBackfillValue(
  subjectKms: Parameters<typeof encryptPiiValueForSubject>[0],
  subject: SubjectId,
  value: unknown,
  kmsCtx: KmsContext,
  field: string,
  isJsonbField: boolean,
): Promise<unknown> {
  return typeof value === "string" && !isJsonbField
    ? encryptPiiValueForSubject(subjectKms, subject, value, kmsCtx, field)
    : encryptPiiJsonValueForSubject(subjectKms, subject, value, kmsCtx, field);
}

type ProjectionOwner = {
  // Undefined when the projection table has no tenant_id column.
  readonly tenantId: string | undefined;
  readonly fields: Record<string, unknown>;
};

// aggregate_id is only unique per tenant: another tenant's projection row must not name the owner.
function projectionOwnerRowOfTenant(
  owner: ProjectionOwner | undefined,
  tenantId: string,
): Record<string, unknown> | undefined {
  if (owner === undefined) return undefined;
  return owner.tenantId === undefined || owner.tenantId === tenantId ? owner.fields : undefined;
}

type RekeyOutcome =
  | { readonly kind: "unchanged" }
  | { readonly kind: "erased" }
  | { readonly kind: "rekeyed"; readonly value: string };

type RekeyDeps = {
  readonly subjectKms: LocalKeyKmsAdapter;
  readonly kmsCtx: KmsContext;
  readonly dryRun: boolean;
  readonly isForgottenSubject: (subject: SubjectId) => Promise<boolean>;
  readonly hasNewerValueOfField: (field: string) => Promise<boolean>;
  readonly predictOutcome: (subject: SubjectId) => Promise<FieldOutcome>;
};

type RekeyTarget = {
  readonly entity: EntityDefinition;
  readonly field: string;
  readonly ciphertext: string;
  readonly tenantId: TenantId;
  readonly aggregateType: string;
  readonly subjectSource: Record<string, unknown>;
  readonly ownerFallback: Record<string, unknown> | undefined;
  readonly projectionOwnerRow: Record<string, unknown> | undefined;
  // The `previous` section of an update event: the state before that event, never the latest.
  readonly isSupersededHistory: boolean;
};

// Stage 4. In dryRun the "rekeyed" value is the untouched ciphertext (nothing is written).
async function rekeyTenantKeyedValue(deps: RekeyDeps, target: RekeyTarget): Promise<RekeyOutcome> {
  const { entity, field, ciphertext } = target;
  const fieldDef = entity.fields[field];
  if (fieldDef === undefined || !isPlainUserOwnedField(fieldDef)) return { kind: "unchanged" };
  if (fieldDef.userOwned.ownerField === field) return rekeySelfOwnedValue(deps, target);

  const keyedUnder = ciphertextSubjectOrNull(ciphertext);
  const userSubject =
    keyedUnder?.kind === "tenant" && keyedUnder.tenantId === target.tenantId
      ? rekeyTargetOfTenantKeyedValue(target)
      : keyedUnder?.kind === "user"
        ? currentProjectionOwnerIfOther(target, fieldDef.userOwned.ownerField, keyedUnder.userId)
        : null;
  if (userSubject === null) return { kind: "unchanged" };
  if (
    keyedUnder?.kind === "user" &&
    (target.isSupersededHistory || (await deps.hasNewerValueOfField(field)))
  ) {
    return { kind: "unchanged" };
  }

  return moveUnderUserSubject(deps, userSubject, ciphertext, field, () =>
    decryptPiiValueForSubject(deps.subjectKms, ciphertext, deps.kmsCtx, field),
  );
}

// The field is its own owner: the key follows the value, so no event history or
// projection decides it, and a stored ciphertext must never be read as the owner id.
async function rekeySelfOwnedValue(deps: RekeyDeps, target: RekeyTarget): Promise<RekeyOutcome> {
  const { field, ciphertext } = target;
  const keyedUnder = ciphertextSubjectOrNull(ciphertext);
  if (keyedUnder === null) return { kind: "unchanged" };
  const ownTenantKey = keyedUnder.kind === "tenant" && keyedUnder.tenantId === target.tenantId;
  if (!ownTenantKey && keyedUnder.kind !== "user") return { kind: "unchanged" };

  const plaintext = await decryptPiiValueForSubject(
    deps.subjectKms,
    ciphertext,
    deps.kmsCtx,
    field,
  );
  if (plaintext === PII_ERASED_SENTINEL) return { kind: "erased" };
  const ownerId = usableOwnerId(plaintext);
  if (ownerId === null) return { kind: "unchanged" };
  if (keyedUnder.kind === "user" && keyedUnder.userId === ownerId) return { kind: "unchanged" };

  return moveUnderUserSubject(
    deps,
    { kind: "user", userId: ownerId },
    ciphertext,
    field,
    async () => plaintext,
  );
}

// For other-owned fields, forgotten and dryRun are decided before the plaintext is read;
// a self-owned field must decrypt first to learn its owner.
async function moveUnderUserSubject(
  deps: RekeyDeps,
  userSubject: SubjectId,
  ciphertext: string,
  field: string,
  readPlaintext: () => Promise<string>,
): Promise<RekeyOutcome> {
  if (await deps.isForgottenSubject(userSubject)) return { kind: "erased" };
  if (deps.dryRun) {
    return (await deps.predictOutcome(userSubject)) === "erased"
      ? { kind: "erased" }
      : { kind: "rekeyed", value: ciphertext };
  }
  const plaintext = await readPlaintext();
  if (plaintext === PII_ERASED_SENTINEL) return { kind: "erased" };
  try {
    const value = await encryptPiiValueForSubject(
      deps.subjectKms,
      userSubject,
      plaintext,
      deps.kmsCtx,
      field,
    );
    return { kind: "rekeyed", value };
  } catch (e) {
    if (e instanceof KeyErasedError) return { kind: "erased" };
    throw e;
  }
}

// Strict chain (payload, then projection) names the owner; an ownerless row of a
// whenAbsent: "self" field falls through to its record key. A whenAbsent: "tenant"
// result is the key the value already sits under — nothing to move.
function rekeyTargetOfTenantKeyedValue(target: RekeyTarget): SubjectId | null {
  const resolution = resolveOwnerSubject(
    target.entity,
    target.field,
    target.subjectSource,
    target.ownerFallback,
    target.projectionOwnerRow,
    target.tenantId,
    target.aggregateType,
  );
  if (resolution.kind !== "resolved") return null;
  const { subject } = resolution;
  return subject.kind === "user" || subject.kind === "record" ? subject : null;
}

// A value keyed under a previous owner moves to the owner the row has now. The
// projection of the event's own tenant is authoritative here: the payload of
// an old created event still names the owner the row had back then.
function currentProjectionOwnerIfOther(
  target: RekeyTarget,
  ownerField: string,
  keyedUserId: string,
): SubjectId | null {
  const owner = usableOwnerId(target.projectionOwnerRow?.[ownerField]);
  return owner === null || owner === keyedUserId ? null : { kind: "user", userId: owner };
}

// Only the row's own tenant key or a user key counts: another tenant's key is
// never decrypted here.
function ciphertextSubjectOrNull(ciphertext: string): SubjectId | null {
  try {
    return piiCiphertextSubject(ciphertext);
  } catch {
    // skip: a malformed ciphertext prefix is not ours to re-key
    return null;
  }
}

export function isLifecycleEventOf(
  eventType: string,
  aggregateType: string,
  entity: Pick<EntityDefinition, "verbs"> | undefined,
): boolean {
  if (!eventType.startsWith(`${aggregateType}.`)) return false;
  const verb = eventType.slice(aggregateType.length + 1);
  return isOneOf(LIFECYCLE_VERBS, verb) || isDeclaredEntityVerb(entity, verb);
}

// created events carry the fields flat; updated carries { changes, previous };
// deleted/forgotten/restored carry { previous }. Returned sections are the
// mutable objects INSIDE the payload clone — encryptField writes in place.
export function lifecycleSections(payload: Record<string, unknown>): Record<string, unknown>[] {
  const sections: Record<string, unknown>[] = [];
  if (isRecord(payload["changes"])) sections.push(payload["changes"]);
  if (isRecord(payload["previous"])) sections.push(payload["previous"]);
  if (sections.length === 0) sections.push(payload);
  return sections;
}

// Same view the live write path resolves from: changes see the merged row,
// previous sees the row before the event with the owner the same event sets as
// fallback. stateBefore fills the keys a slim previous leaves out. aggregate_id
// backs the self-subject when a section lacks the id column.
function lifecycleSubjectView(
  section: Record<string, unknown>,
  payload: Record<string, unknown>,
  aggregateId: string,
  stateBefore: Record<string, unknown>,
): { subjectSource: Record<string, unknown>; ownerFallback: Record<string, unknown> | undefined } {
  const changes = isRecord(payload["changes"]) ? payload["changes"] : undefined;
  const previous = isRecord(payload["previous"]) ? payload["previous"] : undefined;
  if (section === changes) {
    return {
      subjectSource: { id: aggregateId, ...stateBefore, ...previous, ...changes },
      ownerFallback: undefined,
    };
  }
  if (section === previous) {
    return {
      subjectSource: { id: aggregateId, ...stateBefore, ...section },
      ownerFallback: changes,
    };
  }
  return { subjectSource: { id: aggregateId, ...section }, ownerFallback: undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
