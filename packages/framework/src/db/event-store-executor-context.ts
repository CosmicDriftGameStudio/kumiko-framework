import { requestContext } from "../api/request-context.ts";
import {
  collectPiiEncryptedFields,
  collectPiiSubjectFields,
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  encryptPiiFieldValues,
  KeyErasedError,
  type KmsContext,
  type LocalKeyKmsAdapter,
} from "../crypto/index.ts";
import { personalFieldsRekeyedOnOwnerTransition } from "../crypto/owner-transition-rekey.ts";
import { executeRawQueryRead } from "../db/queries/raw-sql.ts";
import type { WhereObject } from "../db/query.ts";
import { shiftParams } from "../engine/ownership.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type {
  EntityDefinition,
  EntityId,
  FieldDefinition,
  SessionUser,
  TenantId,
} from "../engine/types/index.ts";
import {
  AccessDeniedError,
  InternalError,
  subjectErasedConflict,
  UniqueViolationError,
  type WriteFailure,
  writeFailure,
} from "../errors/index.ts";
import { ArchivedStreamError, type EventMetadata, isStreamArchived } from "../event-store/index.ts";
import type { EntityCache } from "../pipeline/entity-cache.ts";
import type { SearchAdapter } from "../search/types.ts";
import type { EnvelopeCipher } from "../secrets/envelope-cipher.ts";
import { assertUnreachable } from "../utils/index.ts";
import { rehydrateCompoundTypes } from "./compound-types.ts";
import type { DbRow } from "./connection.ts";
import type { TableColumns } from "./dialect.ts";
import {
  collectEncryptedFieldNames,
  decryptEntityFieldValues,
  encryptEntityFieldValues,
  logUndecryptableField,
  resolveEntityFieldEncryption,
} from "./entity-field-encryption.ts";
import type { EventStoreExecutorOptions } from "./event-store-executor.ts";
import { constraintOf, isUniqueViolation } from "./pg-error.ts";
import { toSnakeCase } from "./table-builder.ts";
import { columnHandleName, schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

// Shared context-building for the event-store-executor CRUD verbs (create/
// update/delete/forget/restore/list/detail — see event-store-executor-write.ts
// and event-store-executor-read.ts). Precomputes entity-derived state once
// per createEventStoreExecutor() call and bundles the crypto/ownership
// helpers the verbs need, so the verb modules don't each re-derive them.

export type Table = TableColumns;

// Screen filter: maps an operator to a WhereObject condition.
// The boot validator checks field existence, filterability, and operator/type compatibility.
// `op` is normalized to {eq,ne,lt,gt,lte,gte,in}; "in" with an
// empty array explicitly matches nothing.
export function buildFilterWhere(
  field: string,
  op: "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in",
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
    case "lte":
      return { [field]: { lte: value } };
    case "gte":
      return { [field]: { gte: value } };
    case "in":
      if (Array.isArray(value) && value.length > 0) {
        return { [field]: value };
      }
      return null; // no-match short-circuit
    default:
      return assertUnreachable(op, "filter op");
  }
}

// Tenant-based write-ownership rules (from("user:tenantId", "tenantId")) compare the caller's
// tenant with the row's. An explicit cross-tenant grant (streamTenantId, checked against the
// loaded row) is evaluated as the operator acting inside the target tenant. Only this
// evaluation sees the target tenant: stream actor, metadata and PII keys keep the real identity.
export function ownershipSubject(
  user: SessionUser,
  streamTenantId: TenantId | undefined,
): SessionUser {
  return streamTenantId === undefined ? user : { ...user, tenantId: streamTenantId };
}

// Returns the scalar default of a field, or undefined if the field's type
// doesn't carry a default or no default was declared. Only scalar types
// (text/number/boolean/select) support creation-time defaults — money/date/
// file/embedded fields don't.
// A "global" entity's stream must live on SYSTEM_TENANT_ID — otherwise the
// projection row and event stream would disagree on which tenant "owns" it.
export function isForeignTenantOnGlobalEntity(
  entity: EntityDefinition,
  tenantIdValue: unknown,
): boolean {
  if (entity.tenancy !== "global") return false;
  return tenantIdValue !== undefined && tenantIdValue !== SYSTEM_TENANT_ID;
}

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

// Maps PG-23505 (unique-violation) caught from applyEntityEvent
// (create and update paths) to WriteFailure(UniqueViolationError 409).
// Other errors propagate via re-throw. Extracted because this pattern
// occurs in two places in the executor; the caller wraps the
// applyEntityEvent call in try-catch and delegates the mapping here.
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

export type DecryptForReadOptions = {
  // Read paths (list/detail) degrade an undecryptable encrypted field to null
  // and report its name here; write paths omit it and keep failing loud.
  readonly degradeUndecryptable?: (field: string) => void;
};

export type ExecutorContext = {
  readonly table: Table;
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly entityCache?: EntityCache;
  readonly searchAdapter?: SearchAdapter;
  readonly softDelete: boolean;
  readonly streamTenantCreateFailure: (
    db: TenantDb,
    payload: Record<string, unknown>,
    requestedStreamTenantId: TenantId | undefined,
  ) => WriteFailure | undefined;
  readonly streamTenantFor: (user: SessionUser, requestedStreamTenantId?: TenantId) => TenantId;
  readonly streamTenantOverrideFailure: (
    db: TenantDb,
    row: Record<string, unknown>,
    requestedStreamTenantId: TenantId | undefined,
  ) => WriteFailure | undefined;
  readonly idFilter: (id: EntityId) => WhereObject;
  readonly loadById: (
    id: EntityId,
    db: TenantDb,
    options?: { readonly includeDeleted?: boolean },
  ) => Promise<Record<string, unknown> | null>;
  readonly assertStreamWritable: (db: TenantDb, id: EntityId, tenantId: TenantId) => Promise<void>;
  readonly probeOwnershipWithStreamVersion: (
    db: TenantDb,
    idWhere: WhereObject,
    ownership: { kind: "sql"; sqlText: string; params: readonly unknown[] },
    streamTenantId: TenantId,
    aggregateId: string,
  ) => Promise<{ readonly owned: boolean; readonly streamVersion: number }>;
  readonly loadDetailSnapshot: (
    db: TenantDb,
    idWhere: WhereObject,
    ownership:
      | { kind: "pass" }
      | { kind: "empty" }
      | { kind: "sql"; sqlText: string; params: readonly unknown[] },
    streamTenantId: TenantId,
    aggregateId: string,
  ) => Promise<{ readonly row: Record<string, unknown> | null; readonly streamVersion: number }>;
  readonly loadExpectSnapshot: (
    db: TenantDb,
    id: EntityId,
    streamTenantId: TenantId,
    expectKeys: readonly string[],
  ) => Promise<{ readonly row: Record<string, unknown> | null; readonly streamVersion: number }>;
  readonly encryptForStorage: (
    row: Record<string, unknown>,
    user: SessionUser,
    opts?: {
      onlyKeys?: Iterable<string>;
      subjectSource?: Record<string, unknown>;
      keyTenantId?: TenantId | undefined;
      ownerFallback?: Record<string, unknown>;
      onErasedSubject?: "sentinel";
    },
  ) => Promise<Record<string, unknown>>;
  readonly decryptForRead: (
    row: Record<string, unknown>,
    opts?: DecryptForReadOptions,
  ) => Promise<Record<string, unknown>>;
  readonly ownerTransitionRekeys: (
    previous: Record<string, unknown>,
    mergedNew: Record<string, unknown>,
    submittedChanges: Record<string, unknown>,
  ) => Record<string, unknown>;
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

  // Without systemStream: true, a "global" entity would silently fork one event stream per creating tenant.
  if (entity.tenancy === "global" && entity.systemStream !== true) {
    throw new Error(
      `event-store-executor requires entity "${entityName}" to declare systemStream: true ` +
        'when tenancy: "global" is set — a global entity\'s event stream must live on the ' +
        "system tenant, not the creating tenant's.",
    );
  }

  // Stream-tenant choke-point. A systemStream entity (tenant-independent, e.g.
  // user) lives on SYSTEM_TENANT_ID deterministically — every op addresses it
  // there. Everything else stays on the caller's tenant (byte-identical to the
  // old hardcoded user.tenantId). Single source of truth for the stream key.
  const streamTenantFor = (user: SessionUser, requestedStreamTenantId?: TenantId): TenantId =>
    entity.systemStream ? SYSTEM_TENANT_ID : (requestedStreamTenantId ?? user.tenantId);

  // Only a system-mode db (r.systemScope() / acknowledged cross-tenant) or a tenant-mode db bound
  // to exactly that stream tenant (ctx.forTenant) may address another tenant's stream, and only
  // the tenant of the row it just loaded.
  const streamTenantOverrideFailure = (
    db: TenantDb,
    row: Record<string, unknown>,
    requestedStreamTenantId: TenantId | undefined,
  ): WriteFailure | undefined => {
    if (requestedStreamTenantId === undefined) return undefined;
    if (db.mode !== "system" && db.tenantId !== requestedStreamTenantId) {
      return writeFailure(
        new AccessDeniedError({
          message: `${entityName}: streamTenantId requires a system-mode db or a db bound to that tenant`,
        }),
      );
    }
    if (row["tenantId"] !== requestedStreamTenantId) {
      return writeFailure(
        new AccessDeniedError({
          message: `${entityName}: streamTenantId does not match the tenant of the addressed row`,
        }),
      );
    }
    return undefined;
  };

  // Create has no loaded row: the payload's own tenantId (if any) must agree with the target stream.
  const streamTenantCreateFailure = (
    db: TenantDb,
    payload: Record<string, unknown>,
    requestedStreamTenantId: TenantId | undefined,
  ): WriteFailure | undefined =>
    streamTenantOverrideFailure(
      db,
      { tenantId: payload["tenantId"] ?? requestedStreamTenantId },
      requestedStreamTenantId,
    );

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
  // encrypted) — the set only strips the caller-facing event echo so
  // responses never carry the value.
  const sensitiveFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if ("sensitive" in field && field.sensitive === true) {
      sensitiveFields.add(name);
    }
  }

  const encryptedFields = collectEncryptedFieldNames(entity);
  const hasEncryptedFields = encryptedFields.size > 0;

  const piiSubjectFields = collectPiiEncryptedFields(entity);
  const hasPiiFields = piiSubjectFields.length > 0;
  // Decrypt keeps file-reference fields: rows and event payloads written by
  // the old backfill may hold ciphertext there, and decrypt passes plaintext
  // through untouched.
  const piiDecryptFields = collectPiiSubjectFields(entity);
  const hasPiiDecryptFields = piiDecryptFields.length > 0;

  function fieldCipher(): EnvelopeCipher {
    if (options.encryption) return options.encryption;
    return resolveEntityFieldEncryption();
  }

  // No adapter configured = crypto-shredding off; pii fields stay plaintext
  // (previous behavior). The hard boot gate ships with the prod-grade
  // PgKmsAdapter.
  function piiKms(): LocalKeyKmsAdapter | undefined {
    return options.kms ?? configuredPiiSubjectKms();
  }

  function kmsContextFor(user?: SessionUser, keyTenantId?: TenantId): KmsContext {
    return {
      requestId: requestContext.get()?.requestId ?? "event-store-executor",
      ...(user && { tenantId: keyTenantId ?? user.tenantId, userId: String(user.id) }),
    };
  }

  // Async on purpose: the envelope cipher wraps/unwraps DEKs via the
  // MasterKeyProvider. Callers MUST await — a missed await here writes
  // "[object Promise]" into the projection, which the Promise return
  // types turn into a compile error at every call site.
  async function encryptForStorage(
    row: Record<string, unknown>,
    user: SessionUser,
    opts?: {
      onlyKeys?: Iterable<string>;
      subjectSource?: Record<string, unknown>;
      keyTenantId?: TenantId | undefined;
      ownerFallback?: Record<string, unknown>;
      onErasedSubject?: "sentinel";
    },
  ): Promise<Record<string, unknown>> {
    let out = row;
    if (hasEncryptedFields) {
      out = await encryptEntityFieldValues(out, encryptedFields, fieldCipher(), {
        ...(opts?.onlyKeys !== undefined && { onlyKeys: opts.onlyKeys }),
      });
    }
    const kms = piiKms();
    if (hasPiiFields && kms) {
      try {
        out = await encryptPiiFieldValues(
          out,
          entity,
          piiSubjectFields,
          kms,
          kmsContextFor(user, opts?.keyTenantId),
          {
            tenantId: opts?.keyTenantId ?? user.tenantId,
            entityName,
            ...(opts?.onlyKeys !== undefined && { onlyKeys: opts.onlyKeys }),
            ...(opts?.subjectSource !== undefined && { subjectSource: opts.subjectSource }),
            ...(opts?.ownerFallback !== undefined && { ownerFallback: opts.ownerFallback }),
            ...(opts?.onErasedSubject !== undefined && { onErasedSubject: opts.onErasedSubject }),
          },
        );
      } catch (e) {
        if (e instanceof KeyErasedError) throw subjectErasedConflict(e);
        throw e;
      }
    }
    return out;
  }

  // Mirror of encryptForStorage IN REVERSE — a field that carries both
  // `encrypted: true` and a subject marker (userOwned/tenantOwned/pii) is
  // written as PII(envelope(plaintext)) (envelope wraps first, PII wraps
  // that as its outer layer). Decrypt must peel the OUTER layer first: PII
  // unwrap before envelope decrypt, or the envelope cipher chokes on a
  // still-PII-wrapped string (auth-mfa.totpSecret/recoveryCodes combine both
  // markers; see pii-subject-encryption.integration.test.ts).
  async function decryptForRead(
    row: Record<string, unknown>,
    opts?: DecryptForReadOptions,
  ): Promise<Record<string, unknown>> {
    let out = row;
    const kms = piiKms();
    if (hasPiiDecryptFields && kms) {
      out = await decryptPiiFieldValues(out, piiDecryptFields, kms, kmsContextFor());
    }
    if (hasEncryptedFields) {
      out = await decryptEntityFieldValues(
        out,
        encryptedFields,
        fieldCipher(),
        opts?.degradeUndecryptable
          ? {
              onFieldError: (field, error) => {
                logUndecryptableField({ entityName, rowId: row["id"], field, error });
                opts.degradeUndecryptable?.(field);
              },
            }
          : undefined,
      );
    }
    return out;
  }

  function ownerTransitionRekeys(
    previous: Record<string, unknown>,
    mergedNew: Record<string, unknown>,
    submittedChanges: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!hasPiiFields || !piiKms()) return {};
    return personalFieldsRekeyedOnOwnerTransition(entity, previous, mergedNew, submittedChanges);
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

  async function loadById(
    id: EntityId,
    db: TenantDb,
    options?: { readonly includeDeleted?: boolean },
  ): Promise<Record<string, unknown> | null> {
    // Only the soft-delete predicate is relaxed; the tenant filter of db.fetchOne stays.
    const row = await db.fetchOne(table, options?.includeDeleted ? { id } : idFilter(id));
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
    if (await isStreamArchived(tenantDbRunner(db), tenantId, String(id))) {
      throw new ArchivedStreamError(tenantId, String(id));
    }
  }

  // Tenant filter + idFilter + ownership predicate as raw SQL, mirroring what
  // TenantDb.fetchOne/readWhere add. idFilter only yields `id` and a boolean
  // `isDeleted`, so no null/IS NULL branch is needed.
  function buildRawIdWhere(
    db: TenantDb,
    idWhere: WhereObject,
    ownership: { kind: "pass" } | { kind: "sql"; sqlText: string; params: readonly unknown[] },
  ): { whereParts: string[]; params: unknown[] } {
    const colSql = (field: string): string =>
      `"${columnHandleName(table, field) ?? toSnakeCase(field)}"`;
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
    if (ownership.kind === "sql") {
      const shifted = shiftParams(ownership, params.length);
      whereParts.push(shifted.sqlText);
      for (const p of shifted.params) params.push(p);
    }
    return { whereParts, params };
  }

  function streamVersionSubquerySql(aggregateIdParam: number, tenantIdParam: number): string {
    return (
      `(SELECT MAX("version") FROM "kumiko_events" WHERE "aggregate_id" = $${aggregateIdParam} ` +
      `AND "tenant_id" = $${tenantIdParam}) AS "__streamVersion"`
    );
  }

  // Cache-hit revalidation: ownership predicate and live stream version in ONE
  // statement, so a cache hit costs the same single roundtrip as the cold path.
  async function probeOwnershipWithStreamVersion(
    db: TenantDb,
    idWhere: WhereObject,
    ownership: { kind: "sql"; sqlText: string; params: readonly unknown[] },
    streamTenantId: TenantId,
    aggregateId: string,
  ): Promise<{ readonly owned: boolean; readonly streamVersion: number }> {
    const tableName = String(schemaTableName(table));
    const { whereParts, params } = buildRawIdWhere(db, idWhere, ownership);
    params.push(aggregateId, streamTenantId);
    const sqlText =
      `SELECT 1 AS "__owned", ${streamVersionSubquerySql(params.length - 1, params.length)} ` +
      `FROM "${tableName}" WHERE ${whereParts.join(" AND ")} LIMIT 1`;
    const rows = await executeRawQueryRead<Record<string, unknown>>(
      tenantDbRunner(db),
      sqlText,
      params,
    );
    const first = rows[0];
    if (!first) return { owned: false, streamVersion: 0 };
    const version = first["__streamVersion"];
    return { owned: true, streamVersion: typeof version === "number" ? version : 0 };
  }

  // Row and MAX(version) in ONE statement: two reads can pair a post-write
  // version with a pre-write row, and update({version: detail.version}) would
  // then pass the optimistic lock and overwrite the newer write (lost update).
  async function loadDetailSnapshot(
    db: TenantDb,
    idWhere: WhereObject,
    ownership:
      | { kind: "pass" }
      | { kind: "empty" }
      | { kind: "sql"; sqlText: string; params: readonly unknown[] },
    streamTenantId: TenantId,
    aggregateId: string,
  ): Promise<{ readonly row: Record<string, unknown> | null; readonly streamVersion: number }> {
    if (ownership.kind === "empty") return { row: null, streamVersion: 0 };
    const tableName = String(schemaTableName(table));
    const { whereParts, params } = buildRawIdWhere(db, idWhere, ownership);
    params.push(aggregateId, streamTenantId);
    const sqlText =
      `SELECT *, ${streamVersionSubquerySql(params.length - 1, params.length)} ` +
      `FROM "${tableName}" WHERE ${whereParts.join(" AND ")} LIMIT 1`;
    const rows = await executeRawQueryRead<Record<string, unknown>>(
      tenantDbRunner(db),
      sqlText,
      params,
    );
    const first = rows[0];
    if (!first) return { row: null, streamVersion: 0 };
    const { __streamVersion, ...row } = first;
    return {
      row,
      streamVersion: typeof __streamVersion === "number" ? __streamVersion : 0,
    };
  }

  // Reads the `expect:` fields and the aggregate's MAX(version) in ONE statement:
  // projection rows are written after their event commits, so two reads can
  // pair a post-write version with a pre-write row.
  // row.version can't stand in for MAX(version) — raw-seeded/legacy rows carry
  // a default version with no matching events, so the append would target a
  // non-existent predecessor.
  // Raw column values, no decrypt pass: plain (non-pii, non-encrypted) columns only.
  async function loadExpectSnapshot(
    db: TenantDb,
    id: EntityId,
    streamTenantId: TenantId,
    expectKeys: readonly string[],
  ): Promise<{ readonly row: Record<string, unknown> | null; readonly streamVersion: number }> {
    for (const key of expectKeys) {
      if (table[key] === undefined) {
        throw new InternalError({
          message: `expect: "${key}" is not a column of entity "${entityName}"`,
        });
      }
      if (encryptedFields.has(key) || piiSubjectFields.includes(key)) {
        throw new InternalError({
          message: `expect: "${key}" on entity "${entityName}" is stored encrypted and cannot be compared as plaintext`,
        });
      }
    }
    const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;
    const columnOf = (field: string): string =>
      quote(columnHandleName(table, field) ?? toSnakeCase(field));
    const tableName = String(schemaTableName(table));

    const selectCols = expectKeys.map((key) => `${columnOf(key)} AS ${quote(key)}`);
    const whereParts: string[] = [`${columnOf("id")} = $1`];
    const params: unknown[] = [id];
    if (table["tenantId"] !== undefined && db.mode === "tenant") {
      params.push(db.tenantId, SYSTEM_TENANT_ID);
      whereParts.push(`${columnOf("tenantId")} IN ($${params.length - 1}, $${params.length})`);
    }
    params.push(String(id), streamTenantId);
    const streamAggregateIdx = params.length - 1;
    const streamTenantIdx = params.length;

    const sqlText =
      `SELECT ${selectCols.join(", ")}, ` +
      `${streamVersionSubquerySql(streamAggregateIdx, streamTenantIdx)} ` +
      `FROM "${tableName}" WHERE ${whereParts.join(" AND ")} LIMIT 1`;

    const rows = await executeRawQueryRead<Record<string, unknown>>(
      tenantDbRunner(db),
      sqlText,
      params,
    );
    const row = rows[0];
    if (!row) return { row: null, streamVersion: 0 };
    const { __streamVersion, ...fields } = row;
    return {
      row: fields,
      streamVersion: typeof __streamVersion === "number" ? __streamVersion : 0,
    };
  }

  return {
    table,
    entity,
    entityName,
    entityCache,
    searchAdapter,
    softDelete,
    streamTenantFor,
    streamTenantOverrideFailure,
    streamTenantCreateFailure,
    idFilter,
    loadById,
    assertStreamWritable,
    probeOwnershipWithStreamVersion,
    loadDetailSnapshot,
    loadExpectSnapshot,
    encryptForStorage,
    decryptForRead,
    ownerTransitionRekeys,
    applyDefaults,
    stripSensitive,
  };
}
