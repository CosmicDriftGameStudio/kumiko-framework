import { requestContext } from "../api/request-context";
import { executeRawQuery } from "../db/queries/raw-sql";
import type { WhereObject } from "../db/query";
import { coerceRow, extractTableInfo, selectMany } from "../db/query";
import { checkWriteFieldOwnership } from "../engine/field-access";
import {
  buildOwnershipClause,
  shiftParams,
  userCanCreateFieldRow,
  userCanWriteFieldRow,
} from "../engine/ownership";
import type {
  DeleteContext,
  EntityDefinition,
  EntityId,
  FieldDefinition,
  SaveContext,
  SessionUser,
  TenantId,
  WriteResult,
} from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers";
import {
  VersionConflictError as FrameworkVersionConflict,
  InternalError,
  NotFoundError,
  UniqueViolationError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "../errors";
import {
  ArchivedStreamError,
  append,
  type EventMetadata,
  VersionConflictError as EventStoreVersionConflict,
  getStreamVersion,
  isStreamArchived,
} from "../event-store";
import type { EntityCache } from "../pipeline/entity-cache";
import type { SearchAdapter } from "../search/types";
import { assertUnreachable, generateId } from "../utils";
import { applyEntityEvent } from "./apply-entity-event";
import { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types";
import type { DbRow } from "./connection";
import { decodeCursor, encodeCursor } from "./cursor";
import type { TableColumns } from "./dialect";
import type { CursorResult } from "./index";
import { constraintOf, isUniqueViolation } from "./pg-error";
import { toSnakeCase } from "./table-builder";
import type { TenantDb } from "./tenant-db";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

// Screen-Filter (Tier 2.7c) — Op-Mapping als Where-Operator. Boot-
// Validator pinst field-Existenz + filterable + op-vs-Type-Compat.
// `op` ist auf {eq,ne,lt,gt,in} normalisiert; "in" mit empty-array ist
// explizit no-match.
function buildFilterWhere(
  field: string,
  op: "eq" | "ne" | "lt" | "gt" | "in",
  value: unknown,
): WhereObject | null {
  switch (op) {
    case "eq":
      return { [field]: value };
    case "ne":
      return { [field]: { ne: value } };
    case "lt":
      return { [field]: { lt: value } };
    case "gt":
      return { [field]: { gt: value } };
    case "in":
      if (Array.isArray(value) && value.length > 0) {
        return { [field]: value };
      }
      return null; // no-match short-circuit
    default:
      assertUnreachable(op, "filter op");
  }
}

// Returns the scalar default of a field, or undefined if the field's type
// doesn't carry a default or no default was declared. Only scalar types
// (text/number/boolean/select) support creation-time defaults — money/date/
// file/embedded fields don't.
function scalarDefault(field: FieldDefinition): unknown {
  switch (field.type) {
    case "text":
    case "longText":
    case "number":
    case "boolean":
    case "select":
      return field.default;
    default:
      return undefined;
  }
}

// Lifecycle verbs the event-store-executor auto-emits. MSPs that react
// to entity creates/updates/etc should reference this helper instead of
// hardcoding the string — a future rename in the executor then surfaces
// as a type error at every call site rather than a silent miss.
export type EntityLifecycleVerb = "created" | "updated" | "deleted" | "restored";

export function entityEventName(entityName: string, verb: EntityLifecycleVerb): string {
  return `${entityName}.${verb}`;
}

export type EventStoreExecutorOptions = {
  searchAdapter?: SearchAdapter;
  entityName: string; // required — the aggregateType marker on every event
  entityCache?: EntityCache;
};

// F8 helper: PG-23505 (unique-violation) catched aus applyEntityEvent
// (create + update Pfade) → WriteFailure(UniqueViolationError 409).
// Andere Errors propagieren via re-throw. Lokal extrahiert weil das
// Pattern an zwei Stellen im executor lebt — der Caller wrap't den
// applyEntityEvent-call in try-catch und delegiert das Mapping hierher.
//
// Returns WriteFailure on match, null otherwise (caller re-throws).
function tryMapUniqueViolation(e: unknown, entityName: string): WriteFailure | null {
  if (!isUniqueViolation(e)) return null;
  const constraintName = constraintOf(e);
  return writeFailure(
    new UniqueViolationError(
      {
        entityName,
        ...(constraintName !== undefined && { constraintName }),
      },
      { cause: e instanceof Error ? e : undefined },
    ),
  );
}

// Build the metadata envelope for an append. userId always set; requestId +
// correlation + causation come from the AsyncLocalStorage request-context
// when present (e.g. HTTP request, MSP-apply, job run). requestId is a pure
// trace marker — HTTP-level retry idempotency runs separately via
// pipeline/idempotency.ts (Redis-cached response replay), so a single
// request can write N events freely without the events-table needing a
// uniqueness constraint.
function buildEventMetadata(user: SessionUser): EventMetadata {
  const reqCtx = requestContext.get();
  return {
    userId: String(user.id),
    ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
    ...(reqCtx?.correlationId ? { correlationId: reqCtx.correlationId } : {}),
    ...(reqCtx?.causationId ? { causationId: reqCtx.causationId } : {}),
  };
}

// The executor writes events + auto-projection (entity table) in one TX.
// It no longer knows about user projections — those are driven by the
// pipeline, which reads the StoredEvent surfaced on SaveContext/DeleteContext
// and iterates the registry itself. Executor-level `registry` options were
// removed to close the silent-bypass hole where a caller forgetting to pass
// one would skip projections without any signal.
export type EventStoreExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    options?: { skipOptimisticLock?: boolean },
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  list: (
    payload: {
      cursor?: string | undefined;
      limit?: number | undefined;
      search?: string | undefined;
      sort?: string | undefined;
      sortDirection?: "asc" | "desc" | undefined;
      offset?: number | undefined;
      totalCount?: boolean | undefined;
      filter?:
        | {
            readonly field: string;
            readonly op: "eq" | "ne" | "lt" | "gt" | "in";
            readonly value: unknown;
          }
        | undefined;
    },
    user: SessionUser,
    db: TenantDb,
    /** Tier 2.7e Audit-Fix: per-Call SearchAdapter Override. Wenn der
     *  Executor beim Build keinen SearchAdapter via Options bekommen
     *  hat (defaultEntityQueryHandler-Pfad), kann der Caller (Handler)
     *  hier zur Runtime einen aus ctx.searchAdapter durchreichen.
     *  options.searchAdapter (build-time) gewinnt — runtime-Override
     *  ist Fallback für die default-Wrapper. */
    runtimeOptions?: { readonly searchAdapter?: SearchAdapter },
  ) => Promise<CursorResult<Record<string, unknown>>>;

  detail: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<Record<string, unknown> | null>;
};

export function createEventStoreExecutor(
  table: Table,
  entity: EntityDefinition,
  options: EventStoreExecutorOptions,
): EventStoreExecutor {
  const { searchAdapter, entityName, entityCache } = options;
  const softDelete = entity.softDelete ?? false;

  // idType default (undefined) is now "uuid" — the ES-pivot made UUID the
  // only valid aggregate-id type. Explicit `idType: "serial"` is the only
  // shape that's incompatible with the event-store and still rejected.
  if (entity.idType !== undefined && entity.idType !== "uuid") {
    throw new Error(
      `event-store-executor requires entity "${entityName}" to declare idType: "uuid" — ` +
        `got idType: "${entity.idType}". ` +
        `The events-table keys aggregates by uuid(aggregate_id); non-UUID PKs would ` +
        `require a schema split the framework does not currently support. ` +
        `Fix: remove the \`idType\`-override from createEntity({...}) for "${entityName}" ` +
        `(the default is "uuid"). The framework auto-assigns UUIDs on create — ` +
        `you do not need to generate them yourself. ` +
        `See docs/plans/architecture/event-sourcing-pivot.md (section "UUID-only aggregate IDs") for the full rationale.`,
    );
  }

  // Pre-compute defaults once so create() doesn't loop the entity every call.
  const fieldDefaults: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(entity.fields)) {
    const def = scalarDefault(field);
    if (def !== undefined) fieldDefaults[name] = def;
  }

  // Pre-compute the set of sensitive field names once. Every event payload
  // (create data, update changes + previous, delete previous, restore
  // previous) strips these before writing to the immutable event log. Keeps
  // GDPR right-to-be-forgotten tractable — only entity rows hold the
  // sensitive data, and entity rows can be deleted / re-encrypted.
  const sensitiveFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if ("sensitive" in field && field.sensitive === true) {
      sensitiveFields.add(name);
    }
  }

  function applyDefaults(payload: Record<string, unknown>): Record<string, unknown> {
    if (Object.keys(fieldDefaults).length === 0) return payload;
    const result: Record<string, unknown> = { ...payload };
    for (const [name, def] of Object.entries(fieldDefaults)) {
      if (result[name] === undefined) result[name] = def;
    }
    return result;
  }

  function stripSensitive(payload: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!payload) return {};
    if (sensitiveFields.size === 0) return payload;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (sensitiveFields.has(key)) continue;
      result[key] = value;
    }
    return result;
  }

  function idFilter(id: EntityId): WhereObject {
    const filter: WhereObject = { id };
    if (softDelete && table["isDeleted"]) filter["isDeleted"] = false;
    return filter;
  }

  async function loadById(id: EntityId, db: TenantDb): Promise<Record<string, unknown> | null> {
    const row = await db.fetchOne(table, idFilter(id));
    if (!row) return null;
    return rehydrateCompoundTypes(row as DbRow, entity);
  }

  // Archive guard for the CRUD write paths. Archived streams are read-only —
  // ctx.appendEvent (append-event-core) already enforces this, but the
  // executor appends directly via append() and getStreamVersion() ignores
  // the archive flag, so without this check a PATCH/DELETE on an archived
  // entity would silently land an event and break the read-only contract
  // (loadAggregate returns [] for the same stream). Throws ArchivedStreamError
  // to mirror the appendEvent path exactly — same 500 + rolled-back tx.
  // Creates skip this: a fresh UUID can't be archived, and a deterministic-id
  // re-create onto an archived stream collides on the unique index →
  // version_conflict, which already blocks the write.
  async function assertStreamWritable(
    db: TenantDb,
    id: EntityId,
    tenantId: TenantId,
  ): Promise<void> {
    if (await isStreamArchived(db.raw, tenantId, String(id))) {
      throw new ArchivedStreamError(tenantId, String(id));
    }
  }

  // SELECT a row by id with the ownership clause applied at the DB layer.
  // Detail() uses this both on cold path and as a cache-revalidation probe.
  async function loadWithOwnership(
    db: TenantDb,
    idWhere: WhereObject,
    ownership:
      | { kind: "pass" }
      | { kind: "empty" }
      | { kind: "sql"; sqlText: string; params: readonly unknown[] },
  ): Promise<Record<string, unknown>[]> {
    if (ownership.kind === "empty") return [];
    if (ownership.kind === "pass") {
      const row = await db.fetchOne(table, idWhere);
      return row ? [row as Record<string, unknown>] : [];
    }
    // ownership has raw SQL — splice it into a raw query alongside the
    // idFilter + tenant-filter that TenantDb would have added.
    const tableName = String(
      (table as unknown as Record<symbol, unknown>)[Symbol.for("kumiko:schema:Name")],
    );
    const colSql = (field: string): string =>
      `"${(table[field] as { name?: string } | undefined)?.name ?? toSnakeCase(field)}"`;
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (table["tenantId"] !== undefined && db.mode === "tenant") {
      params.push(db.tenantId, SYSTEM_TENANT_ID);
      whereParts.push(`${colSql("tenantId")} IN ($${params.length - 1}, $${params.length})`);
    }
    for (const [field, value] of Object.entries(idWhere)) {
      if (typeof value === "boolean") {
        whereParts.push(`${colSql(field)} = ${value ? "TRUE" : "FALSE"}`);
      } else {
        params.push(value);
        whereParts.push(`${colSql(field)} = $${params.length}`);
      }
    }
    const shifted = shiftParams(ownership, params.length);
    whereParts.push(shifted.sqlText);
    for (const p of shifted.params) params.push(p);
    const sqlText = `SELECT * FROM "${tableName}" WHERE ${whereParts.join(" AND ")} LIMIT 1`;
    return [...(await executeRawQuery<Record<string, unknown>>(db.raw, sqlText, params))];
  }

  return {
    async create(payload, user, db) {
      // Respect an explicit id in the payload (seed pattern, SCIM import). Without
      // one the framework mints a fresh UUIDv7 via generateId. Strip it out of the
      // event payload so defaults + downstream consumers don't see a redundant id field.
      const explicitId = typeof payload["id"] === "string" ? (payload["id"] as string) : undefined; // @cast-boundary engine-payload
      const aggregateId = explicitId ?? generateId();
      const { id: _id, ...payloadWithoutId } = payload;
      const data = applyDefaults(payloadWithoutId);

      // H.2 — entity-level write-ownership on create. No oldRow exists, so
      // only the new row is checked. No Straddle concern for creates.
      if (!userCanCreateFieldRow(user, entity.access?.write, data)) {
        return writeFailure(
          new UnprocessableError("ownership_denied", {
            i18nKey: "errors.ownershipDenied",
            details: { scope: "entity", entityName, action: "create", userId: user.id },
          }),
        );
      }

      // Field-level write-ownership on create — mirror of entity-level but
      // per declared field. Role-level was already checked by the
      // dispatcher; here we enforce ownership-rules against the new row.
      const fieldDeniedCreate = checkWriteFieldOwnership(entity, data, user);
      if (fieldDeniedCreate) {
        return writeFailure(
          new UnprocessableError("ownership_denied", {
            i18nKey: "errors.ownershipDenied",
            details: {
              scope: "field",
              entityName,
              action: "create",
              field: fieldDeniedCreate,
              userId: user.id,
            },
          }),
        );
      }

      // Alle Compound-Types (locatedTimestamp, money, ...) gehen durch
      // dieselbe Pipeline. Caller schickt combined API-Form, Framework
      // speichert flat DB-Form. Siehe db/compound-types.ts.
      const flatData = flattenCompoundTypes(data, entity);

      // 1. Append event (same TX as the projection write — both must succeed
      //    or both roll back; the dispatcher wraps both in one transaction).
      //    Sensitive fields are stripped from the event payload; the entity
      //    row below still receives the full data.
      //
      //    `expectedVersion: 0` heißt: stream existiert noch nicht. Bei
      //    deterministic-aggregate-id-Patterns (z.B. uuidv5(tenantId|naturalKey))
      //    ist es legitim dass create kollidiert — selbe id, schon vorhandener
      //    stream → version_conflict statt internal_error. Update hat den
      //    selben catch (siehe line 493+).
      let event: Awaited<ReturnType<typeof append>>;
      try {
        event = await append(db.raw, {
          aggregateId,
          aggregateType: entityName,
          tenantId: user.tenantId,
          expectedVersion: 0,
          type: entityEventName(entityName, "created"),
          payload: stripSensitive(flatData),
          metadata: buildEventMetadata(user),
        });
      } catch (e) {
        if (e instanceof EventStoreVersionConflict) {
          // Try to look up the real stream-version for the diagnostic — but
          // wrap defensively: when `append` raised the unique-violation, the
          // current TX is already aborted, and a second query on the same
          // runner would re-throw "current transaction is aborted". Update-
          // path doesn't have this problem (it queries getStreamVersion
          // BEFORE the try-block). Falling back to a sentinel keeps the
          // version_conflict mapping reliable; the actual current version
          // is recoverable client-side via a fresh detail-query if needed.
          let currentVersion = -1;
          try {
            currentVersion = await getStreamVersion(db.raw, aggregateId, user.tenantId);
          } catch {
            // Aborted TX or any lookup failure — keep the sentinel.
          }
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: aggregateId,
              expectedVersion: 0,
              currentVersion,
            }),
          );
        }
        throw e;
      }

      // 2. Update projection via applyEntityEvent — derselbe Code-Pfad den
      //    rebuildProjection für Replay nutzt → Live==Rebuild by-construction.
      //    Wir bauen ein "live event" mit unstripped flatData (damit sensitive
      //    Felder in der Read-Tabelle landen, aber nicht im Event-Log).
      //
      //    F8-Patch: app-level unique-violations (z.B. (tenantId, email)
      //    auf User-Entity, (tenantId, slug) auf Article) werfen pg-23505
      //    aus der projection-INSERT. Ohne den catch propagiert das als
      //    unhandled exception → 500 internal_error. Map auf
      //    UniqueViolationError 409 damit Designer/Frontend einen sauberen
      //    "duplicate" zeigen können statt cryptic "internal server error".
      const liveEvent = { ...event, payload: flatData };
      let result: Awaited<ReturnType<typeof applyEntityEvent>>;
      try {
        result = await applyEntityEvent(liveEvent, table, entity, db.raw);
      } catch (e) {
        const mapped = tryMapUniqueViolation(e, entityName);
        if (mapped) return mapped;
        throw e;
      }
      if (result.kind !== "applied" || result.row === null) {
        return writeFailure(new InternalError({ message: "projection insert returned no row" }));
      }
      const row = result.row;
      // Read-Side Auto-Convert: DB-Form → API-combined-Form für alle
      // Compound-Types in einem Pass.
      const projection = rehydrateCompoundTypes(row as DbRow, entity) as DbRow;

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, aggregateId);
      }

      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: aggregateId,
          data: projection,
          changes: data,
          previous: {},
          isNew: true,
          entityName,
          event,
        },
      };
    },

    async update(payload, user, db, updateOptions) {
      const previous = await loadById(payload.id, db);
      if (!previous) return writeFailure(new NotFoundError(entityName, payload.id));

      // H.2 — entity-level write-ownership on update. Load old row (already
      // done above), build post-change row via shallow merge. Straddle-safe
      // multi-role check: at least one role must accept BOTH old and new —
      // prevents the attack where role A passes old, role B passes new and
      // aggregation would wrongly allow a row-grab.
      const mergedNew: Record<string, unknown> = { ...previous, ...payload.changes };
      if (!userCanWriteFieldRow(user, entity.access?.write, previous, mergedNew)) {
        return writeFailure(
          new UnprocessableError("ownership_denied", {
            i18nKey: "errors.ownershipDenied",
            details: {
              scope: "entity",
              entityName,
              action: "update",
              userId: user.id,
              entityId: payload.id,
            },
          }),
        );
      }

      // Field-level write-ownership on update — this is the path the
      // dispatcher could not evaluate (no oldRow). Now that we have
      // `previous`, we can run the ownership rules per field against both
      // sides and reject individual fields the user isn't entitled to
      // touch on this specific row.
      const fieldDeniedUpdate = checkWriteFieldOwnership(entity, payload.changes, user, previous);
      if (fieldDeniedUpdate) {
        return writeFailure(
          new UnprocessableError("ownership_denied", {
            i18nKey: "errors.ownershipDenied",
            details: {
              scope: "field",
              entityName,
              action: "update",
              field: fieldDeniedUpdate,
              userId: user.id,
              entityId: payload.id,
            },
          }),
        );
      }

      await assertStreamWritable(db, payload.id, user.tenantId);

      // Stream-version is authoritative, not row.version. `ctx.appendEvent`
      // can bump the stream between CRUD writes (domain event on the same
      // aggregate); a stale row.version here would make the next CRUD write
      // trip `events_aggregate_version_uq` (tenant_id, aggregate_id, version)
      // with version_conflict.
      const currentVersion = await getStreamVersion(db.raw, String(payload.id), user.tenantId);
      if (!updateOptions?.skipOptimisticLock) {
        if (payload.version === undefined) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: 0,
              currentVersion,
            }),
          );
        }
        if (currentVersion !== payload.version) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: payload.version,
              currentVersion,
            }),
          );
        }
      }

      try {
        // Compound-Types Auto-Convert (alle in einem Pass).
        const flatChanges = flattenCompoundTypes(payload.changes, entity);

        // The event payload carries BOTH `changes` (what the user asked for) AND
        // `previous` (the pre-update row). Cross-aggregate projections need the
        // previous value to decrement/undo when a parent-FK moves — without it
        // you'd have to snapshot-and-diff on every apply, and replays would
        // break. Storage cost is acceptable (rows are bounded), correctness is
        // not negotiable. Sensitive fields are stripped from BOTH halves so
        // they never reach the immutable event log.
        const event = await append(db.raw, {
          aggregateId: String(payload.id),
          aggregateType: entityName,
          tenantId: user.tenantId,
          expectedVersion: currentVersion,
          type: entityEventName(entityName, "updated"),
          payload: {
            changes: stripSensitive(flatChanges),
            previous: stripSensitive(previous),
          },
          metadata: buildEventMetadata(user),
        });

        // Live==Rebuild via applyEntityEvent: live-event mit unstripped
        // flatChanges damit sensitive Felder in der Read-Tabelle landen.
        //
        // F8-Patch: dasselbe unique-violation-handling wie im create-Pfad
        // — ein update das einen unique-Index verletzt (z.B. email-update
        // auf einen schon-existierenden Wert) wird mit 409 unique_violation
        // statt 500 internal_error rückgemeldet.
        const liveEvent = {
          ...event,
          payload: { changes: flatChanges, previous },
        };
        let result: Awaited<ReturnType<typeof applyEntityEvent>>;
        try {
          result = await applyEntityEvent(liveEvent, table, entity, db.raw);
        } catch (e) {
          const mapped = tryMapUniqueViolation(e, entityName);
          if (mapped) return mapped;
          throw e;
        }
        if (result.kind !== "applied" || result.row === null) {
          return writeFailure(new InternalError({ message: "projection update returned no row" }));
        }
        const row = result.row;
        const data = rehydrateCompoundTypes(row as DbRow, entity) as DbRow;

        if (entityCache && entityName) {
          await entityCache.del(user.tenantId, entityName, payload.id);
        }

        return {
          isSuccess: true,
          data: {
            kind: "save",
            id: data["id"] as EntityId, // @cast-boundary engine-payload
            data,
            changes: payload.changes,
            previous,
            isNew: false,
            entityName,
            event,
          },
        };
      } catch (e) {
        // The pre-check above eliminates the common stale-version case; this
        // branch catches the narrow race where two writers both read version=N
        // and both pass the local check — the unique index on (aggregate_id,
        // version) serializes them, one wins, the other lands here.
        if (e instanceof EventStoreVersionConflict) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: payload.version ?? 0,
              currentVersion,
            }),
          );
        }
        throw e;
      }
    },

    async delete(payload, user, db) {
      const existing = await loadById(payload.id, db);
      if (!existing) return writeFailure(new NotFoundError(entityName, payload.id));

      // H.2 — entity-level write-ownership on delete. Only the pre-delete
      // row matters (there's no "new" row for a delete); passing existing
      // twice to userCanWriteFieldRow makes the Straddle check trivial
      // (same row on both sides) while keeping the multi-role-atomic shape.
      if (!userCanWriteFieldRow(user, entity.access?.write, existing, existing)) {
        return writeFailure(
          new UnprocessableError("ownership_denied", {
            i18nKey: "errors.ownershipDenied",
            details: {
              scope: "entity",
              entityName,
              action: "delete",
              userId: user.id,
              entityId: payload.id,
            },
          }),
        );
      }

      await assertStreamWritable(db, payload.id, user.tenantId);

      // Stream-version authoritative (see update() for rationale).
      const currentVersion = await getStreamVersion(db.raw, String(payload.id), user.tenantId);

      // Deletes carry the full pre-delete row as `previous`. That's what
      // projections and downstream consumers need to reverse any aggregates —
      // a `{}`-payload delete would make cross-aggregate projections impossible
      // to rebuild from the event log alone. Sensitive fields are stripped.
      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: currentVersion,
        type: entityEventName(entityName, "deleted"),
        payload: { previous: stripSensitive(existing) },
        metadata: buildEventMetadata(user),
      });

      // Live==Rebuild via applyEntityEvent. Delete-Operation hat keine
      // sensitive-Drift weil das Event-Payload nur `previous` ist und das
      // wird vom soft/hard-delete-Code gar nicht in die Tabelle geschrieben
      // (nur isDeleted/deletedAt/version-Bump). Live + Replay schreiben
      // dasselbe — kein payload-override nötig.
      const deleteResult = await applyEntityEvent(event, table, entity, db.raw);
      if (deleteResult.kind !== "applied") {
        return writeFailure(
          new InternalError({ message: "projection delete: applyEntityEvent skipped" }),
        );
      }

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: { kind: "delete", id: payload.id, data: existing, entityName, event },
      };
    },

    async restore(payload, user, db) {
      if (!softDelete) {
        return writeFailure(
          new UnprocessableError("soft_delete_not_enabled", {
            i18nKey: "errors.softDeleteNotEnabled",
          }),
        );
      }

      const [row] = await selectMany(db.raw, table, { id: payload.id });
      if (!row) return writeFailure(new NotFoundError(entityName, payload.id));
      const data = row as DbRow;
      if (!data["isDeleted"]) {
        return writeFailure(
          new UnprocessableError("not_deleted", { i18nKey: "errors.notDeleted" }),
        );
      }

      // H.2 — entity-level write-ownership on restore. Same shape as delete:
      // only the stored row matters. Stored row carries pre-soft-delete
      // teamId/... fields, so the ownership predicate still applies cleanly.
      if (!userCanWriteFieldRow(user, entity.access?.write, data, data)) {
        return writeFailure(
          new UnprocessableError("ownership_denied", {
            i18nKey: "errors.ownershipDenied",
            details: {
              scope: "entity",
              entityName,
              action: "restore",
              userId: user.id,
              entityId: payload.id,
            },
          }),
        );
      }

      await assertStreamWritable(db, payload.id, user.tenantId);

      // Stream-version authoritative (see update() for rationale).
      const currentVersion = await getStreamVersion(db.raw, String(payload.id), user.tenantId);
      // Restore carries the soft-deleted snapshot as `previous` — mirror of
      // delete for symmetry. Projections that decremented on delete use
      // `previous` to re-increment on restore without re-querying the entity
      // table. Sensitive fields are stripped.
      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: currentVersion,
        type: entityEventName(entityName, "restored"),
        payload: { previous: stripSensitive(data) },
        metadata: buildEventMetadata(user),
      });

      // Live==Rebuild via applyEntityEvent. Restore schreibt nur isDeleted=
      // false + version-Bump in die Tabelle — keine sensitive-Drift, daher
      // kein payload-override nötig.
      const restoreResult = await applyEntityEvent(event, table, entity, db.raw);
      if (restoreResult.kind !== "applied" || restoreResult.row === null) {
        return writeFailure(new InternalError({ message: "projection restore returned no row" }));
      }
      const restored = restoreResult.row;

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      // Read-Side Auto-Convert für Compound-Types (parallel zu update/list).
      const restoredHydrated = rehydrateCompoundTypes(restored as DbRow, entity) as DbRow;

      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: payload.id,
          data: restoredHydrated,
          changes: { isDeleted: false },
          previous: data,
          isNew: false,
          entityName,
          event,
        },
      };
    },

    // list + detail are unchanged from crud-executor — projections are the
    // read-model and serve these queries directly.
    async list(payload, user, db, runtimeOptions) {
      const limit = payload.limit ?? 50;
      const offset = payload.offset ?? 0;
      const totalCount = payload.totalCount === true;

      // H.2 — entity-level read ownership. Decide before touching search or
      // the DB: `empty` means there's no row the user could ever see, so
      // skip both paths and return an empty page.
      const ownership = buildOwnershipClause(user, entity.access?.read, table);
      if (ownership.kind === "empty") {
        return { rows: [], nextCursor: null, ...(totalCount && { total: 0 }) };
      }

      let filterIds: EntityId[] | undefined;
      // Build-Time options.searchAdapter gewinnt; runtime-Override ist
      // Fallback für die defaultEntityQueryHandler-Pipe (die nutzt den
      // ctx.searchAdapter erst zur Laufzeit weil createEventStoreExecutor
      // beim Definition-Time noch keinen Server-Context hat).
      const effectiveSearchAdapter = searchAdapter ?? runtimeOptions?.searchAdapter;
      if (payload.search && effectiveSearchAdapter && entityName) {
        const results = await effectiveSearchAdapter.search(user.tenantId, payload.search, {
          filterType: entityName,
        });
        filterIds = results.map((r) => r.entityId);
        if (filterIds.length === 0) {
          return { rows: [], nextCursor: null, ...(totalCount && { total: 0 }) };
        }
      }

      // Build the WHERE clause as raw SQL — ownership produces a
      // parameterised fragment that we splice in alongside simple WhereObject
      // conditions (cursor, search-filter-IDs, screen-filter, tenant-scope).
      const tableName = String(
        (table as unknown as Record<symbol, unknown>)[Symbol.for("kumiko:schema:Name")],
      );
      const whereSql: string[] = [];
      const params: unknown[] = [];
      const colSql = (field: string): string =>
        `"${(table[field] as { name?: string } | undefined)?.name ?? toSnakeCase(field)}"`;

      // Tenant-Filter (replicates TenantDb's readWhere semantics).
      if (table["tenantId"] !== undefined && db.mode === "tenant") {
        params.push(db.tenantId, SYSTEM_TENANT_ID);
        whereSql.push(`${colSql("tenantId")} IN ($${params.length - 1}, $${params.length})`);
      }
      if (softDelete && table["isDeleted"]) {
        whereSql.push(`${colSql("isDeleted")} = FALSE`);
      }
      if (payload.cursor) {
        params.push(decodeCursor(payload.cursor));
        whereSql.push(`${colSql("id")} > $${params.length}`);
      }
      if (filterIds) {
        const placeholders = filterIds.map((id) => {
          params.push(id);
          return `$${params.length}`;
        });
        whereSql.push(`${colSql("id")} IN (${placeholders.join(", ")})`);
      }
      if (ownership.kind === "sql") {
        const shifted = shiftParams(
          { sqlText: ownership.sqlText, params: ownership.params },
          params.length,
        );
        whereSql.push(shifted.sqlText);
        for (const p of shifted.params) params.push(p);
      }
      if (payload.filter !== undefined) {
        const col = table[payload.filter.field];
        if (col !== undefined) {
          const screen = buildFilterWhere(
            payload.filter.field,
            payload.filter.op,
            payload.filter.value,
          );
          if (screen === null) {
            whereSql.push("FALSE");
          } else {
            for (const [field, value] of Object.entries(screen)) {
              if (Array.isArray(value)) {
                const placeholders = value.map((v) => {
                  params.push(v);
                  return `$${params.length}`;
                });
                whereSql.push(`${colSql(field)} IN (${placeholders.join(", ")})`);
              } else if (typeof value === "object" && value !== null) {
                const opMap: Record<string, string> = {
                  gt: ">",
                  gte: ">=",
                  lt: "<",
                  lte: "<=",
                  ne: "<>",
                };
                for (const [opKey, opSym] of Object.entries(opMap)) {
                  if (!(opKey in value)) continue;
                  params.push((value as Record<string, unknown>)[opKey]);
                  whereSql.push(`${colSql(field)} ${opSym} $${params.length}`);
                }
              } else {
                params.push(value);
                whereSql.push(`${colSql(field)} = $${params.length}`);
              }
            }
          }
        }
      }

      const orderByClause =
        payload.sort && table[payload.sort]
          ? ` ORDER BY ${colSql(payload.sort)} ${payload.sortDirection === "desc" ? "DESC" : "ASC"}`
          : "";
      const useOffset = !payload.cursor && offset > 0;
      const offsetClause = useOffset ? ` OFFSET ${offset}` : "";

      const whereClauseSqlText = whereSql.length > 0 ? ` WHERE ${whereSql.join(" AND ")}` : "";
      const listSql = `SELECT * FROM "${tableName}"${whereClauseSqlText}${orderByClause} LIMIT ${limit}${offsetClause}`;

      const rawRows = await executeRawQuery<Record<string, unknown>>(db.raw, listSql, params);
      // Read-Side rehydrate pro Row + snake→camel coercion für driver-agnostic Feldnamen
      const tableInfo = extractTableInfo(table);
      const rows = rawRows.map((r) => coerceRow(rehydrateCompoundTypes(r, entity), tableInfo));

      if (entityCache && entityName && rows.length > 0) {
        await entityCache.mset(
          user.tenantId,
          entityName,
          rows.map((r) => ({ id: r["id"] as EntityId, data: r })), // @cast-boundary engine-payload
        );
      }

      const lastRow = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && lastRow ? encodeCursor(lastRow["id"] as string) : null; // @cast-boundary engine-payload

      // total: extra COUNT(*) — nur wenn explizit angefordert (Pager-UI).
      // Postgres-Cost ist O(table-scan) ohne Filter, mit Filter so teuer
      // wie der entsprechende WHERE — bei indexed columns billig genug.
      // Bei Search-Path ist `total = filterIds.length` ohne extra Query.
      let total: number | undefined;
      if (totalCount) {
        if (filterIds) {
          total = filterIds.length;
        } else {
          const countSql = `SELECT COUNT(*)::int AS count FROM "${tableName}"${whereClauseSqlText}`;
          const countRows = await executeRawQuery<{ count: number }>(db.raw, countSql, params);
          total = countRows[0]?.count ?? 0;
        }
      }

      return { rows, nextCursor, ...(total !== undefined && { total }) };
    },

    async detail(payload, user, db) {
      // H.2 — ownership check. `empty` → the user can never see this row
      // regardless of its id. Return null (same shape as "not found", so a
      // probing attacker can't distinguish "no access" from "doesn't exist").
      const ownership = buildOwnershipClause(user, entity.access?.read, table);
      if (ownership.kind === "empty") return null;

      const idWhere = idFilter(payload.id);

      if (entityCache && entityName) {
        const cached = await entityCache.get(user.tenantId, entityName, payload.id);
        if (cached) {
          if (ownership.kind === "sql") {
            // Re-check ownership predicate against the live row — the cache
            // is keyed only by tenant + id, not by role.
            const checkRows = await loadWithOwnership(db, idWhere, ownership);
            if (checkRows.length === 0) return null;
          }
          return cached;
        }
      }

      const rows = await loadWithOwnership(db, idWhere, ownership);
      const raw = rows[0];
      if (!raw) return null;
      const row = rehydrateCompoundTypes(raw, entity);
      const rowInfo = extractTableInfo(table);
      const coerced = coerceRow(row, rowInfo);

      if (entityCache && entityName) {
        await entityCache.set(user.tenantId, entityName, payload.id, coerced);
      }

      return coerced;
    },
  };
}
