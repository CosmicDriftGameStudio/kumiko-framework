import { requestContext } from "../api/request-context";
import {
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  encryptPiiFieldValues,
  type KmsContext,
  type LocalKeyKmsAdapter,
} from "../crypto";
import { executeRawQuery } from "../db/queries/raw-sql";
import type { WhereObject } from "../db/query";
import { shiftParams } from "../engine/ownership";
import type {
  EntityDefinition,
  EntityId,
  FieldDefinition,
  SessionUser,
  TenantId,
} from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers";
import { UniqueViolationError, type WriteFailure, writeFailure } from "../errors";
import { ArchivedStreamError, type EventMetadata, isStreamArchived } from "../event-store";
import type { EntityCache } from "../pipeline/entity-cache";
import type { SearchAdapter } from "../search/types";
import type { EnvelopeCipher } from "../secrets/envelope-cipher";
import { assertUnreachable } from "../utils";
import { rehydrateCompoundTypes } from "./compound-types";
import type { DbRow } from "./connection";
import type { TableColumns } from "./dialect";
import {
  collectEncryptedFieldNames,
  decryptEntityFieldValues,
  encryptEntityFieldValues,
  resolveEntityFieldEncryption,
} from "./entity-field-encryption";
import type { EventStoreExecutorOptions } from "./event-store-executor";
import { constraintOf, isUniqueViolation } from "./pg-error";
import { toSnakeCase } from "./table-builder";
import type { TenantDb } from "./tenant-db";

// Shared context-building for the event-store-executor CRUD verbs (create/
// update/delete/forget/restore/list/detail — see event-store-executor-write.ts
// and event-store-executor-read.ts). Precomputes entity-derived state once
// per createEventStoreExecutor() call and bundles the crypto/ownership
// helpers the verbs need, so the verb modules don't each re-derive them.

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
export type Table = TableColumns<any>;

// Screen-Filter (Tier 2.7c) — Op-Mapping als Where-Operator. Boot-
// Validator pinst field-Existenz + filterable + op-vs-Type-Compat.
// `op` ist auf {eq,ne,lt,gt,in} normalisiert; "in" mit empty-array ist
// explizit no-match.
export function buildFilterWhere(
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
      return assertUnreachable(op, "filter op");
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

// F8 helper: PG-23505 (unique-violation) catched aus applyEntityEvent
// (create + update Pfade) → WriteFailure(UniqueViolationError 409).
// Andere Errors propagieren via re-throw. Lokal extrahiert weil das
// Pattern an zwei Stellen im executor lebt — der Caller wrap't den
// applyEntityEvent-call in try-catch und delegiert das Mapping hierher.
//
// Returns WriteFailure on match, null otherwise (caller re-throws).
export function tryMapUniqueViolation(e: unknown, entityName: string): WriteFailure | null {
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
export function buildEventMetadata(user: SessionUser): EventMetadata {
  const reqCtx = requestContext.get();
  return {
    userId: String(user.id),
    ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
    ...(reqCtx?.correlationId ? { correlationId: reqCtx.correlationId } : {}),
    ...(reqCtx?.causationId ? { causationId: reqCtx.causationId } : {}),
  };
}

// Lifecycle verbs the event-store-executor auto-emits. MSPs that react
// to entity creates/updates/etc should reference this helper instead of
// hardcoding the string — a future rename in the executor then surfaces
// as a type error at every call site rather than a silent miss.
export type EntityLifecycleVerb = "created" | "updated" | "deleted" | "restored" | "forgotten";

export function entityEventName(entityName: string, verb: EntityLifecycleVerb): string {
  return `${entityName}.${verb}`;
}

export type ExecutorContext = {
  readonly table: Table;
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly entityCache?: EntityCache;
  readonly searchAdapter?: SearchAdapter;
  readonly softDelete: boolean;
  readonly streamTenantFor: (user: SessionUser) => TenantId;
  readonly idFilter: (id: EntityId) => WhereObject;
  readonly loadById: (id: EntityId, db: TenantDb) => Promise<Record<string, unknown> | null>;
  readonly assertStreamWritable: (db: TenantDb, id: EntityId, tenantId: TenantId) => Promise<void>;
  readonly loadWithOwnership: (
    db: TenantDb,
    idWhere: WhereObject,
    ownership:
      | { kind: "pass" }
      | { kind: "empty" }
      | { kind: "sql"; sqlText: string; params: readonly unknown[] },
  ) => Promise<Record<string, unknown>[]>;
  readonly encryptForStorage: (
    row: Record<string, unknown>,
    user: SessionUser,
    opts?: { onlyKeys?: Iterable<string>; subjectSource?: Record<string, unknown> },
  ) => Promise<Record<string, unknown>>;
  readonly decryptForRead: (row: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly applyDefaults: (payload: Record<string, unknown>) => Record<string, unknown>;
  readonly stripSensitive: (
    payload: Record<string, unknown> | undefined,
  ) => Record<string, unknown>;
};

export function buildExecutorContext(
  table: Table,
  entity: EntityDefinition,
  options: EventStoreExecutorOptions,
): ExecutorContext {
  const { searchAdapter, entityName, entityCache } = options;
  const softDelete = entity.softDelete ?? false;

  // Stream-tenant choke-point. A systemStream entity (tenant-independent, e.g.
  // user) lives on SYSTEM_TENANT_ID deterministically — every op addresses it
  // there. Everything else stays on the caller's tenant (byte-identical to the
  // old hardcoded user.tenantId). Single source of truth for the stream key.
  const streamTenantFor = (user: SessionUser): TenantId =>
    entity.systemStream ? SYSTEM_TENANT_ID : user.tenantId;

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

  // Pre-compute the set of sensitive field names once. The event log stores
  // these fields as table ciphertext (boot validates sensitive ⇒ pii |
  // encrypted, #967) — the set only strips the caller-facing event echo so
  // responses never carry the value (#820).
  const sensitiveFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if ("sensitive" in field && field.sensitive === true) {
      sensitiveFields.add(name);
    }
  }

  const encryptedFields = collectEncryptedFieldNames(entity);
  const hasEncryptedFields = encryptedFields.size > 0;

  const piiSubjectFields = collectPiiSubjectFields(entity);
  const hasPiiFields = piiSubjectFields.length > 0;

  function fieldCipher(): EnvelopeCipher {
    if (options.encryption) return options.encryption;
    return resolveEntityFieldEncryption();
  }

  // No adapter configured = crypto-shredding off; pii fields stay plaintext
  // (pre-#724 behavior). The hard boot gate ships with the prod-grade
  // PgKmsAdapter (phase E).
  function piiKms(): LocalKeyKmsAdapter | undefined {
    return options.kms ?? configuredPiiSubjectKms();
  }

  function kmsContextFor(user?: SessionUser): KmsContext {
    return {
      requestId: requestContext.get()?.requestId ?? "event-store-executor",
      ...(user && { tenantId: user.tenantId, userId: String(user.id) }),
    };
  }

  // Async on purpose: the envelope cipher wraps/unwraps DEKs via the
  // MasterKeyProvider. Callers MUST await — a missed await here writes
  // "[object Promise]" into the projection, which the Promise return
  // types turn into a compile error at every call site.
  async function encryptForStorage(
    row: Record<string, unknown>,
    user: SessionUser,
    opts?: { onlyKeys?: Iterable<string>; subjectSource?: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    let out = row;
    if (hasEncryptedFields) {
      out = await encryptEntityFieldValues(out, encryptedFields, fieldCipher(), {
        ...(opts?.onlyKeys !== undefined && { onlyKeys: opts.onlyKeys }),
      });
    }
    const kms = piiKms();
    if (hasPiiFields && kms) {
      out = await encryptPiiFieldValues(out, entity, piiSubjectFields, kms, kmsContextFor(user), {
        tenantId: user.tenantId,
        ...(opts?.onlyKeys !== undefined && { onlyKeys: opts.onlyKeys }),
        ...(opts?.subjectSource !== undefined && { subjectSource: opts.subjectSource }),
      });
    }
    return out;
  }

  async function decryptForRead(row: Record<string, unknown>): Promise<Record<string, unknown>> {
    let out = row;
    if (hasEncryptedFields) {
      out = await decryptEntityFieldValues(out, encryptedFields, fieldCipher());
    }
    const kms = piiKms();
    if (hasPiiFields && kms) {
      out = await decryptPiiFieldValues(out, piiSubjectFields, kms, kmsContextFor());
    }
    return out;
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
    return await decryptForRead(rehydrateCompoundTypes(row as DbRow, entity));
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
    table,
    entity,
    entityName,
    entityCache,
    searchAdapter,
    softDelete,
    streamTenantFor,
    idFilter,
    loadById,
    assertStreamWritable,
    loadWithOwnership,
    encryptForStorage,
    decryptForRead,
    applyDefaults,
    stripSensitive,
  };
}
