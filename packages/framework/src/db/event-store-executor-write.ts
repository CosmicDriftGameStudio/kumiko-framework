import type { ParentVisibilityOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { ZodType } from "zod";
import {
  type ErasedSubjectHandling,
  ErasedSubjectHandlings,
} from "../crypto/pii-field-encryption.ts";
import { checkWriteFieldOwnership } from "../engine/field-access.ts";
import { instructionFieldNames } from "../engine/instruction-fields.ts";
import { userCanCreateFieldRow, userCanWriteFieldRow } from "../engine/ownership.ts";
import { buildInsertSchema, buildUpdateSchema } from "../engine/schema-builder.ts";
import { isRecordLocked, isUnchangedValue } from "../engine/screen-helpers.ts";
import type { SessionUser, TenantId } from "../engine/types/index.ts";
import {
  IdempotentReplayError,
  PreconditionFailedError,
  RecordLockedError,
} from "../errors/classes.ts";
import {
  AccessDeniedError,
  VersionConflictError as FrameworkVersionConflict,
  InternalError,
  NotFoundError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "../errors/index.ts";
import { isSubjectErasedConflict } from "../errors/subject-erased.ts";
import { IdempotentAppendConflictError as EventStoreIdempotentAppendConflict } from "../event-store/errors.ts";
import {
  append,
  VersionConflictError as EventStoreVersionConflict,
  getStreamVersion,
} from "../event-store/index.ts";

import {
  assertInstructionFieldWriteAllowed,
  assertIrreversibleOperationAllowed,
  isIrreversibleEntityVerb,
} from "../pipeline/irreversible-operation-gate.ts";
import { generateId } from "../utils/index.ts";
import { applyEntityEvent } from "./apply-entity-event.ts";
import { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types.ts";
import type { DbRow } from "./connection.ts";
import {
  type EventStoreExecutor,
  type LockGuardOption,
  WritePurposes,
} from "./event-store-executor.ts";
import {
  buildEventMetadata,
  type ExecutorContext,
  entityEventName,
  isForeignTenantOnGlobalEntity,
  ownershipSubject,
  tryMapUniqueViolation,
} from "./event-store-executor-context.ts";
import {
  fieldStateFailure,
  optimisticLockFailure,
  ownershipDeniedFailure,
  projectEntityEvent,
  runPreSave,
} from "./event-store-executor-write-steps.ts";
import { isFrameworkSystemUser, isLockGuardBypassed } from "./lock-guard.ts";
import { runInSavepointIfSupported } from "./query.ts";
import { assertPersonalDataWrite, tableNameOf, withExecutorManagedWrites } from "./tenant-db.ts";
import { tenantDbWriteRunner } from "./tenant-db-runner.ts";

type WriteRunner = ReturnType<typeof tenantDbWriteRunner>;
type AppendedEvent = Awaited<ReturnType<typeof append>>;
type UpdateOptions = Parameters<EventStoreExecutor["update"]>[3];

// The five write verbs (create/update/delete/forget/restore) of the event-
// store-executor, split out of event-store-executor.ts. They read an explicit
// ExecutorContext instead of capturing the factory's local scope directly.

export function createWriteVerbs(
  ctx: ExecutorContext,
): Pick<EventStoreExecutor, "create" | "update" | "delete" | "forget" | "restore"> {
  const {
    table,
    entity,
    entityName,
    entityCache,
    softDelete,
    streamTenantFor,
    streamTenantOverrideFailure,
    streamTenantCreateFailure,
    encryptForStorage,
    decryptForRead,
    ownerTransitionRekeys,
    applyDefaults,
    stripSensitive,
    loadById,
    assertStreamWritable,
    isRowReadable,
    loadExpectSnapshot,
  } = ctx;
  const entityInstructionFieldNames = instructionFieldNames(entity);

  // A row the caller cannot read is reported as missing, like detail does, so a write
  // can neither change it nor echo its content back. Framework system writes skip the
  // check as they do for forget: their role never appears in a per-role read map.
  async function unreadableRowFailure(
    id: EntityId,
    user: SessionUser,
    db: TenantDb,
    parentVisibility: ParentVisibilityOption | undefined,
  ): Promise<WriteFailure | undefined> {
    if (isFrameworkSystemUser(user) || (await isRowReadable(id, user, db, parentVisibility))) {
      return undefined;
    }
    return writeFailure(new NotFoundError(entityName, id));
  }

  // update and delete funnel through here, so custom handlers and nested writes cannot
  // bypass the lock whatever they return. Setting the lock (unlocked row) passes.
  // Framework system writes that name a writePurpose (retention, erasure) are exempt:
  // statutory deletion must reach locked rows, and forget (Art. 17) never checks the lock
  // at all. The options are server-code only; no request field is ever copied into them.
  function recordLockedFailure(
    row: Readonly<Record<string, unknown>>,
    id: EntityId,
    user: SessionUser,
    options: LockGuardOption | undefined,
  ): WriteFailure | undefined {
    if (isLockGuardBypassed(user, options) || !isRecordLocked(entity.lockedWhen, row)) {
      return undefined;
    }
    return writeFailure(new RecordLockedError({ entityName, entityId: id }));
  }
  // Erasure writes run after the subject key is gone; they store the erased
  // sentinel for that subject's fields instead of failing on re-encrypt.
  function erasureSentinelOption(
    options: LockGuardOption | undefined,
  ): { readonly onErasedSubject: ErasedSubjectHandling } | Record<string, never> {
    return options?.writePurpose === WritePurposes.erasure
      ? { onErasedSubject: ErasedSubjectHandlings.sentinel }
      : {};
  }
  const eventVersion = entity.eventVersion ?? 1;
  let insertSchema: ZodType | undefined;
  let updateSchema: ZodType | undefined;
  const createOutputSchema = () => (insertSchema ??= buildInsertSchema(entity));
  const updateOutputSchema = () => (updateSchema ??= buildUpdateSchema(entity));

  // Tenant boundary: db.fetchOne applies TenantDb's tenant predicate,
  // selectMany(runner, ...) did not — any caller could un-delete a foreign
  // tenant's row by id. "system"-mode dbs (r.systemScope() / escapeHatch
  // handlers) still read unfiltered. No isDeleted filter in the read: restore
  // targets exactly the soft-deleted row.
  async function loadSoftDeletedRow(
    db: TenantDb,
    id: EntityId,
    streamTenantId: TenantId | undefined,
  ): Promise<{ readonly row: DbRow } | { readonly failure: WriteFailure }> {
    const row = await db.fetchOne(table, { id });
    if (!row) return { failure: writeFailure(new NotFoundError(entityName, id)) };
    const streamTenantMismatch = streamTenantOverrideFailure(db, row, streamTenantId);
    if (streamTenantMismatch) return { failure: streamTenantMismatch };
    if (!row["isDeleted"]) {
      return {
        failure: writeFailure(
          new UnprocessableError("not_deleted", { i18nKey: "errors.notDeleted" }),
        ),
      };
    }
    return { row: row as DbRow };
  }

  // A forgotten subject has no key any more: restore re-encrypts the stored row and reports
  // that as a failure result like any other write conflict instead of throwing.
  async function appendRestoredEvent(
    runner: WriteRunner,
    user: SessionUser,
    id: EntityId,
    previousPlain: DbRow,
    streamTenantId: TenantId | undefined,
    currentVersion: number,
  ): Promise<{ readonly event: AppendedEvent } | { readonly failure: WriteFailure }> {
    try {
      const previous = await encryptForStorage(previousPlain, user, {
        keyTenantId: streamTenantId,
      });
      const event = await runInSavepointIfSupported(runner, (sp) =>
        append(sp, {
          aggregateId: String(id),
          aggregateType: entityName,
          tenantId: streamTenantFor(user, streamTenantId),
          expectedVersion: currentVersion,
          type: entityEventName(entityName, "restored"),
          eventVersion,
          payload: { previous },
          metadata: buildEventMetadata(user),
        }),
      );
      return { event };
    } catch (e) {
      if (isSubjectErasedConflict(e)) return { failure: writeFailure(e) };
      return {
        failure: await appendConflictFailure(e, runner, {
          entityId: id,
          expectedVersion: currentVersion,
          streamTenant: streamTenantFor(user, streamTenantId),
        }),
      };
    }
  }

  // Fallback for conflicts that carry no current version: the version read before the
  // append is stale after a lost race. -1 when the lookup itself fails.
  async function versionAfterConflict(
    runner: ReturnType<typeof tenantDbWriteRunner>,
    aggregateId: string,
    tenantId: TenantId,
  ): Promise<number> {
    try {
      return await getStreamVersion(runner, aggregateId, tenantId);
    } catch {
      return -1;
    }
  }

  async function expectedStreamVersion(
    db: TenantDb,
    id: EntityId,
    streamTenant: TenantId,
    expect: Readonly<Record<string, unknown>>,
  ): Promise<number | WriteFailure> {
    const snapshot = await loadExpectSnapshot(db, id, streamTenant, Object.keys(expect));
    const row = snapshot.row;
    if (!row) return writeFailure(new PreconditionFailedError({ entityId: id, field: "id" }));
    const mismatch = Object.entries(expect).find(([key, expected]) => row[key] !== expected);
    if (mismatch) {
      return writeFailure(new PreconditionFailedError({ entityId: id, field: mismatch[0] }));
    }
    return snapshot.streamVersion;
  }
  async function appendConflictFailure(
    error: unknown,
    runner: WriteRunner,
    conflict: {
      readonly entityId: EntityId;
      readonly expectedVersion: number;
      readonly streamTenant: TenantId;
    },
  ): Promise<WriteFailure> {
    if (error instanceof EventStoreVersionConflict) {
      return writeFailure(
        new FrameworkVersionConflict({
          entityId: conflict.entityId,
          expectedVersion: conflict.expectedVersion,
          currentVersion:
            error.currentVersion ??
            (await versionAfterConflict(runner, String(conflict.entityId), conflict.streamTenant)),
        }),
      );
    }
    if (error instanceof EventStoreIdempotentAppendConflict) {
      return writeFailure(new IdempotentReplayError({ idempotencyKey: error.idempotencyKey }));
    }
    throw error;
  }

  // Stream-version is authoritative, not row.version. `ctx.events.append`
  // can bump the stream between CRUD writes (domain event on the same
  // aggregate); a stale row.version here would make the next CRUD write
  // trip `events_aggregate_version_uq` (tenant_id, aggregate_id, version)
  // with version_conflict.
  //
  // With `expect:` the version comes from loadExpectSnapshot's combined
  // query instead; see its comment for why.
  async function currentStreamVersion(
    db: TenantDb,
    runner: WriteRunner,
    id: EntityId,
    streamTenant: TenantId,
    expect: Readonly<Record<string, unknown>> | undefined,
  ): Promise<number | WriteFailure> {
    return expect
      ? await expectedStreamVersion(db, id, streamTenant, expect)
      : await getStreamVersion(runner, String(id), streamTenant);
  }

  function assertFieldWritesAllowed(db: TenantDb, action: "create" | "update", data: DbRow): void {
    // After preSave so derived fields count, before the event append so nothing persists.
    assertPersonalDataWrite(db, tableNameOf(table), Object.keys(data), entity);
    assertInstructionFieldWriteAllowed(
      entityName,
      action,
      Object.keys(data),
      entityInstructionFieldNames,
    );
  }

  function createOwnershipFailure(
    user: SessionUser,
    streamTenantId: TenantId | undefined,
    payloadWithoutId: Record<string, unknown>,
    data: DbRow,
  ): WriteFailure | undefined {
    // H.2 — entity-level write-ownership on create. No oldRow exists, so
    // only the new row is checked. No Straddle concern for creates.
    if (
      !userCanCreateFieldRow(ownershipSubject(user, streamTenantId), entity.access?.write, data)
    ) {
      return ownershipDeniedFailure({
        scope: "entity",
        entityName,
        action: "create",
        userId: user.id,
      });
    }

    // Field-level write-ownership on create — mirror of entity-level but
    // per declared field. Role-level was already checked by the
    // dispatcher; here we enforce ownership-rules against the new row.
    //
    // Which fields get checked is scoped to the pre-hook payload
    // — a hook-derived field the user never submitted must not be
    // field-ownership-checked against the user. The rule for a checked
    // field is still evaluated against the full post-hook row (`data`) —
    // an ownership rule can reference a column only a hook populates.
    const fieldDeniedCreate = checkWriteFieldOwnership(
      entity,
      applyDefaults(payloadWithoutId),
      ownershipSubject(user, streamTenantId),
      undefined,
      data,
    );
    if (fieldDeniedCreate) {
      return ownershipDeniedFailure({
        scope: "field",
        entityName,
        action: "create",
        field: fieldDeniedCreate,
        userId: user.id,
      });
    }
    return undefined;
  }

  function updateOwnershipFailure(
    user: SessionUser,
    streamTenantId: TenantId | undefined,
    id: EntityId,
    submittedChanges: Record<string, unknown>,
    previous: DbRow,
    changes: DbRow,
    mergedNew: Record<string, unknown>,
  ): WriteFailure | undefined {
    // H.2 — entity-level write-ownership on update. Load old row (already
    // done above), build post-change row via shallow merge. Straddle-safe
    // multi-role check: at least one role must accept BOTH old and new —
    // prevents the attack where role A passes old, role B passes new and
    // aggregation would wrongly allow a row-grab.
    if (
      !userCanWriteFieldRow(
        ownershipSubject(user, streamTenantId),
        entity.access?.write,
        previous,
        mergedNew,
      )
    ) {
      return ownershipDeniedFailure({
        scope: "entity",
        entityName,
        action: "update",
        userId: user.id,
        entityId: id,
      });
    }
    // Field-level write-ownership on update — this is the path the
    // dispatcher could not evaluate (no oldRow). Now that we have
    // `previous`, we can run the ownership rules per field against both
    // sides and reject individual fields the user isn't entitled to
    // touch on this specific row.
    //
    // Which fields get checked is scoped to `payload.changes` (the user's
    // actual submission), NOT `changes` (post-preSave-hook data)
    // — a hook-derived field the user never submitted (e.g. a system hook
    // setting `assignedTo`) has no business being field-ownership-checked
    // against the *user*, and doing so rejects writes the user is fully
    // entitled to make. The dispatcher's role-gate (checkWriteFieldAccess)
    // already runs on this same pre-hook payload for consistency. The rule
    // for a checked field is still evaluated against the full post-hook
    // row (`changes` merged onto `previous`) — an ownership rule can
    // reference a column only a hook populates.
    const fieldDeniedUpdate = checkWriteFieldOwnership(
      entity,
      submittedChanges,
      ownershipSubject(user, streamTenantId),
      previous,
      changes,
    );
    if (fieldDeniedUpdate) {
      return ownershipDeniedFailure({
        scope: "field",
        entityName,
        action: "update",
        field: fieldDeniedUpdate,
        userId: user.id,
        entityId: id,
      });
    }
    return undefined;
  }

  function updateSelectOptionFailure(
    user: SessionUser,
    mergedNew: Record<string, unknown>,
    previous: DbRow,
    options: UpdateOptions,
  ): WriteFailure | undefined {
    // Statutory retention/erasure writes may change a condition field (e.g. null a PII
    // reference) and must not be blocked by the select rule — same exemption as the lock.
    const isStatutorySystemWrite =
      options?.writePurpose !== undefined && isFrameworkSystemUser(user);
    if (isStatutorySystemWrite) return undefined;
    return fieldStateFailure(entity.fields, mergedNew, previous);
  }

  async function appendCreatedEvent(
    runner: WriteRunner,
    user: SessionUser,
    streamTenantId: TenantId | undefined,
    aggregateId: string,
    flatData: Record<string, unknown>,
  ): Promise<{ readonly event: AppendedEvent } | { readonly failure: WriteFailure }> {
    // 1. Append the event in the same transaction as the projection write — both must
    //    succeed or both roll back; the dispatcher wraps them in one transaction.
    //    flatData is already table ciphertext for pii/encrypted fields, so the immutable
    //    log never sees plaintext and replay reproduces the row byte-for-byte.
    //
    //    `expectedVersion: 0` means the stream does not yet exist. With deterministic
    //    aggregate-ID patterns (for example, uuidv5(tenantId|naturalKey)), a create can
    //    legitimately collide — the same ID has an existing stream — so return
    //    version_conflict instead of internal_error. Update uses the same catch.
    try {
      // Savepoint-scoped: Postgres aborts the WHOLE surrounding
      // transaction once any statement inside it errors, even if the JS error
      // is caught — a losing concurrent create's unique-violation
      // would otherwise abort the caller's outer transaction and surface as
      // internal_error at commit time instead of the version_conflict this
      // catch classifies. runInSavepointIfSupported confines the failed
      // INSERT to a nested scope that rolls back on its own (same pattern as
      // ctx.events.tryAppend), and falls back to a plain call when the runner
      // is a bare pool connection with no active transaction to poison
      // (seeds/tests calling the executor directly).
      const event = await runInSavepointIfSupported(runner, async (sp) =>
        append(sp, {
          aggregateId,
          aggregateType: entityName,
          tenantId: streamTenantFor(user, streamTenantId),
          expectedVersion: 0,
          type: entityEventName(entityName, "created"),
          eventVersion,
          payload: flatData,
          metadata: buildEventMetadata(user),
        }),
      );
      return { event };
    } catch (e) {
      return {
        failure: await appendConflictFailure(e, runner, {
          entityId: aggregateId,
          expectedVersion: 0,
          streamTenant: streamTenantFor(user, streamTenantId),
        }),
      };
    }
  }

  // 2. Update the projection through applyEntityEvent — the same code path used by
  //    rebuildProjection for replay, with the same StoredEvent, so live and rebuild
  //    produce the same result by construction.
  //
  //    Application-level unique violations (for example, (tenantId, email) on a User
  //    entity or (tenantId, slug) on an Article) produce pg-23505 from the projection
  //    write. Without this catch, the error propagates as an unhandled exception and
  //    becomes a 500 internal_error. Map it to UniqueViolationError 409 so the
  //    designer/frontend can show a clear "duplicate" message instead of a cryptic
  //    "internal server error".
  // Savepoint like the append: an unclassified DB error from the projection
  // write would otherwise poison the enclosing transaction (Postgres aborts the
  // whole transaction once any statement in it fails). The savepoint rolls back the failed
  // write while allowing the error to propagate and remain catchable.
  async function applyProjection(
    runner: WriteRunner,
    event: AppendedEvent,
    noRowMessage: string,
  ): Promise<{ readonly row: DbRow } | { readonly failure: WriteFailure }> {
    let result: Awaited<ReturnType<typeof applyEntityEvent>>;
    try {
      result = await runInSavepointIfSupported(withExecutorManagedWrites(runner), async (sp) =>
        applyEntityEvent(event, table, entity, sp),
      );
    } catch (e) {
      const mapped = tryMapUniqueViolation(e, entityName);
      if (mapped) return { failure: mapped };
      throw e;
    }
    if (result.kind !== "applied" || result.row === null) {
      return { failure: writeFailure(new InternalError({ message: noRowMessage })) };
    }
    return { row: result.row };
  }

  // Read-side conversion: DB form → combined API form for all compound types in one pass.
  async function readProjectedRow(row: DbRow): Promise<DbRow> {
    return await decryptForRead(rehydrateCompoundTypes(row, entity) as DbRow);
  }

  async function evictCachedEntity(
    user: SessionUser,
    streamTenantId: TenantId | undefined,
    id: EntityId,
  ): Promise<void> {
    if (entityCache && entityName) {
      await entityCache.del(streamTenantId ?? user.tenantId, entityName, id);
    }
  }

  async function encryptUpdatePayload(
    user: SessionUser,
    streamTenantId: TenantId | undefined,
    previous: DbRow,
    changes: DbRow,
    mergedNew: Record<string, unknown>,
    options: UpdateOptions,
  ) {
    // Compound-type conversion in one pass.
    // subjectSource: partial changes may carry a pii field without its
    // ownerField — the merged row still identifies the subject.
    // skipUnchanged is opt-in: an identical resubmitted key is dropped before
    // encryption so pii/encrypted fields receive no fresh ciphertext when nothing
    // actually changed.
    // Direct callers (KEK rotation, backfill) rely on the default to force re-encryption.
    const submittedChanges = options?.skipUnchanged
      ? Object.fromEntries(
          Object.entries(changes).filter(([key, value]) => !isUnchangedValue(value, previous[key])),
        )
      : changes;
    // Crypto-shredding follows the current owner, so personal
    // fields not in this update are re-written under the new owner's key.
    // Owner -> absent is not re-keyed; the value stays under the old owner.
    const changesToPersist = {
      ...submittedChanges,
      ...ownerTransitionRekeys(previous, mergedNew, submittedChanges),
    };
    const flatChangesPlain = flattenCompoundTypes(changesToPersist, entity);
    const flatChanges = await encryptForStorage(flatChangesPlain, user, {
      onlyKeys: Object.keys(changesToPersist),
      subjectSource: mergedNew,
      keyTenantId: streamTenantId,
      ...erasureSentinelOption(options),
    });

    // The event payload carries BOTH `changes` (what the user asked for) AND
    // `previous` (the pre-update row). Cross-aggregate projections need the
    // previous value to decrement/undo when a parent-FK moves — without it
    // you'd have to snapshot-and-diff on every apply, and replays would
    // break. Storage cost is acceptable (rows are bounded), correctness is
    // not negotiable. `previous` came from loadById(), which decrypts —
    // re-encrypt it before it's persisted so plaintext of pii/encrypted
    // fields doesn't land in the immutable log (flatChanges is already
    // ciphertext from encryptForStorage above).
    // Owner chain for the ownerless-then-assigned row: previous owner, then
    // the owner this event sets, then whenAbsent.
    const encryptedPrevious = await encryptForStorage(previous, user, {
      keyTenantId: streamTenantId,
      ownerFallback: submittedChanges,
      ...erasureSentinelOption(options),
    });
    return { flatChangesPlain, flatChanges, encryptedPrevious };
  }

  async function appendUpdatedEvent(
    runner: WriteRunner,
    user: SessionUser,
    id: EntityId,
    streamTenant: TenantId,
    currentVersion: number,
    flatChanges: Record<string, unknown>,
    encryptedPrevious: Record<string, unknown>,
  ): Promise<AppendedEvent> {
    // Savepoint-scoped — see appendCreatedEvent for why:
    // confines a losing writer's unique-violation to a nested scope
    // instead of poisoning the whole outer transaction.
    return await runInSavepointIfSupported(runner, (sp) =>
      append(sp, {
        aggregateId: String(id),
        aggregateType: entityName,
        tenantId: streamTenant,
        expectedVersion: currentVersion,
        type: entityEventName(entityName, "updated"),
        eventVersion,
        payload: {
          changes: flatChanges,
          previous: encryptedPrevious,
        },
        metadata: buildEventMetadata(user),
      }),
    );
  }

  async function persistUpdate(input: {
    readonly db: TenantDb;
    readonly runner: WriteRunner;
    readonly user: SessionUser;
    readonly id: EntityId;
    readonly previous: DbRow;
    readonly changes: DbRow;
    readonly mergedNew: Record<string, unknown>;
    readonly streamTenantId: TenantId | undefined;
    readonly streamTenant: TenantId;
    readonly currentVersion: number;
    readonly options: UpdateOptions;
  }): Promise<
    { readonly data: DbRow; readonly echoEvent: AppendedEvent } | { readonly failure: WriteFailure }
  > {
    const { db, runner, user, id, previous, changes, mergedNew, streamTenantId } = input;
    const { flatChangesPlain, flatChanges, encryptedPrevious } = await encryptUpdatePayload(
      user,
      streamTenantId,
      previous,
      changes,
      mergedNew,
      input.options,
    );
    const event = await appendUpdatedEvent(
      runner,
      user,
      id,
      input.streamTenant,
      input.currentVersion,
      flatChanges,
      encryptedPrevious,
    );

    // Live and rebuild use applyEntityEvent with the same StoredEvent —
    // apply reads only `changes`, which contain identical ciphertext in live writes
    // and replays.
    //
    // An update that violates a unique index (for example, an email update to an
    // already-existing value) is reported as 409 unique_violation instead of 500
    // internal_error.
    // Savepoint like the create path: a raw DB error from the projection UPDATE would
    // otherwise poison the enclosing transaction, so a sibling write after a failed
    // nested one would throw 500 instead of failing cleanly.
    const projected = await applyProjection(runner, event, "projection update returned no row");
    if ("failure" in projected) return projected;
    const data = await readProjectedRow(projected.row);
    await evictCachedEntity(user, streamTenantId, id);

    const echoEvent = {
      ...event,
      payload: {
        changes: stripSensitive(flatChangesPlain),
        previous: stripSensitive(previous),
      },
    };
    await projectEntityEvent(db, runner, echoEvent);
    return { data, echoEvent };
  }

  function assertTenantAllowedOnGlobalEntity(
    verb: "create" | "update",
    payloadField: string,
    tenantId: unknown,
  ): void {
    if (isForeignTenantOnGlobalEntity(entity, tenantId)) {
      throw new AccessDeniedError({
        message: `${entityName}.${verb}: entity is tenancy: "global" — ${payloadField} must be SYSTEM_TENANT_ID or omitted.`,
      });
    }
  }

  return {
    async create(payload, user, db, options) {
      assertTenantAllowedOnGlobalEntity("create", "payload.tenantId", payload["tenantId"]);
      const streamTenantId = options?.streamTenantId;
      const streamTenantMismatch = streamTenantCreateFailure(db, payload, streamTenantId);
      if (streamTenantMismatch) return streamTenantMismatch;
      const runner = tenantDbWriteRunner(db, "ctx.db executor create");
      // Respect an explicit id in the payload (seed pattern, SCIM import). Without
      // one the framework mints a fresh UUIDv7 via generateId. Strip it out of the
      // event payload so defaults + downstream consumers don't see a redundant id field.
      const explicitId = typeof payload["id"] === "string" ? (payload["id"] as string) : undefined; // @cast-boundary engine-payload
      const aggregateId = explicitId ?? generateId();
      const { id: _id, ...payloadWithoutId } = payload;
      const preSaveResult = await runPreSave(
        options?.preSave,
        applyDefaults(payloadWithoutId),
        {},
        true,
        entityName,
        "create",
        createOutputSchema,
      );
      if ("failure" in preSaveResult) return preSaveResult.failure;
      const data = preSaveResult.data;

      assertFieldWritesAllowed(db, "create", data);
      const ownershipDenied = createOwnershipFailure(user, streamTenantId, payloadWithoutId, data);
      if (ownershipDenied) return ownershipDenied;

      const invalidFieldState = fieldStateFailure(entity.fields, data);
      if (invalidFieldState) return invalidFieldState;

      // All compound types (locatedTimestamp, money, ...) use the same pipeline: the
      // caller sends the combined API form, the framework stores the flat DB form (see
      // db/compound-types.ts).
      // subjectSource carries the freshly minted aggregateId: the create payload has no id
      // column, but a pii:true self-subject resolves from it.
      const flatCreateData = flattenCompoundTypes(data, entity);
      const flatData = await encryptForStorage(flatCreateData, user, {
        subjectSource: { ...flatCreateData, id: aggregateId },
        keyTenantId: streamTenantId,
      });

      const appended = await appendCreatedEvent(
        runner,
        user,
        streamTenantId,
        aggregateId,
        flatData,
      );
      if ("failure" in appended) return appended.failure;
      const event = appended.event;

      const projected = await applyProjection(runner, event, "projection insert returned no row");
      if ("failure" in projected) return projected.failure;
      const projection = await readProjectedRow(projected.row);
      await evictCachedEntity(user, streamTenantId, aggregateId);

      // The echoed event is the one projections see (and the dispatcher later
      // skips), so build it before projecting.
      const echoEvent = { ...event, payload: stripSensitive(flatCreateData) };
      await projectEntityEvent(db, runner, echoEvent);

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
          // Persisted event carries ciphertext by design — the caller-facing
          // echo must be plaintext like every other response field.
          event: echoEvent,
        },
      };
    },

    async update(payload, user, db, updateOptions) {
      const runner = tenantDbWriteRunner(db, "ctx.db executor update");
      assertTenantAllowedOnGlobalEntity(
        "update",
        "payload.changes.tenantId",
        payload.changes["tenantId"],
      );
      const previous = await loadById(payload.id, db, {
        includeDeleted: updateOptions?.includeDeleted === true,
      });
      if (!previous) return writeFailure(new NotFoundError(entityName, payload.id));
      const unreadable = await unreadableRowFailure(
        payload.id,
        user,
        db,
        updateOptions?.parentVisibility,
      );
      if (unreadable) return unreadable;
      const streamTenantId = updateOptions?.streamTenantId;
      const streamTenantMismatch = streamTenantOverrideFailure(db, previous, streamTenantId);
      if (streamTenantMismatch) return streamTenantMismatch;
      const preSaveResult = await runPreSave(
        updateOptions?.preSave,
        payload.changes,
        previous,
        false,
        entityName,
        "update",
        updateOutputSchema,
      );
      if ("failure" in preSaveResult) return preSaveResult.failure;
      const changes = preSaveResult.data;

      assertFieldWritesAllowed(db, "update", changes);

      const mergedNew: Record<string, unknown> = { ...previous, ...changes };
      const guardFailure =
        updateOwnershipFailure(
          user,
          streamTenantId,
          payload.id,
          payload.changes,
          previous,
          changes,
          mergedNew,
        ) ??
        recordLockedFailure(previous, payload.id, user, updateOptions) ??
        updateSelectOptionFailure(user, mergedNew, previous, updateOptions);
      if (guardFailure) return guardFailure;

      const streamTenant = streamTenantFor(user, streamTenantId);
      await assertStreamWritable(db, payload.id, streamTenant);

      const currentVersion = await currentStreamVersion(
        db,
        runner,
        payload.id,
        streamTenant,
        updateOptions?.expect,
      );
      if (typeof currentVersion !== "number") return currentVersion;

      const versionConflict = optimisticLockFailure(
        payload.id,
        payload.version,
        currentVersion,
        updateOptions?.skipOptimisticLock,
      );
      if (versionConflict) return versionConflict;

      try {
        const persisted = await persistUpdate({
          db,
          runner,
          user,
          id: payload.id,
          previous,
          changes,
          mergedNew,
          streamTenantId,
          streamTenant,
          currentVersion,
          options: updateOptions,
        });
        if ("failure" in persisted) return persisted.failure;
        const { data, echoEvent } = persisted;
        return {
          isSuccess: true,
          data: {
            kind: "save",
            id: data["id"] as EntityId, // @cast-boundary engine-payload
            data,
            changes,
            previous,
            isNew: false,
            entityName,
            event: echoEvent,
          },
        };
      } catch (e) {
        // The pre-check above eliminates the common stale-version case; this
        // branch catches the narrow race where two writers both read version=N
        // and both pass the local check — the unique index on (aggregate_id,
        // version) serializes them, one wins, the other lands here.
        return await appendConflictFailure(e, runner, {
          entityId: payload.id,
          expectedVersion: currentVersion,
          streamTenant,
        });
      }
    },

    async delete(payload, user, db, options) {
      if (isIrreversibleEntityVerb("delete", entity)) {
        assertIrreversibleOperationAllowed(`${entityName}.delete (entity has no softDelete)`);
      }
      const runner = tenantDbWriteRunner(db, "ctx.db executor delete");
      const existing = await loadById(payload.id, db);
      if (!existing) return writeFailure(new NotFoundError(entityName, payload.id));
      const unreadable = await unreadableRowFailure(
        payload.id,
        user,
        db,
        options?.parentVisibility,
      );
      if (unreadable) return unreadable;
      const streamTenantId = options?.streamTenantId;
      const streamTenantMismatch = streamTenantOverrideFailure(db, existing, streamTenantId);
      if (streamTenantMismatch) return streamTenantMismatch;

      // H.2 — entity-level write-ownership on delete. Only the pre-delete
      // row matters (there's no "new" row for a delete); passing existing
      // twice to userCanWriteFieldRow makes the Straddle check trivial
      // (same row on both sides) while keeping the multi-role-atomic shape.
      if (
        !userCanWriteFieldRow(
          ownershipSubject(user, streamTenantId),
          entity.access?.write,
          existing,
          existing,
        )
      ) {
        return ownershipDeniedFailure({
          scope: "entity",
          entityName,
          action: "delete",
          userId: user.id,
          entityId: payload.id,
        });
      }

      const lockedDelete = recordLockedFailure(existing, payload.id, user, options);
      if (lockedDelete) return lockedDelete;

      await assertStreamWritable(db, payload.id, streamTenantFor(user, streamTenantId));

      // Stream-version authoritative (see update() for rationale).
      const currentVersion = await getStreamVersion(
        runner,
        String(payload.id),
        streamTenantFor(user, streamTenantId),
      );

      // Deletes carry the full pre-delete row as `previous`. That's what
      // projections and downstream consumers need to reverse any aggregates —
      // a `{}`-payload delete would make cross-aggregate projections impossible
      // to rebuild from the event log alone. `existing` came from loadById(),
      // which decrypts — re-encrypt before persisting so plaintext doesn't
      // land in the immutable log.
      let event: AppendedEvent;
      try {
        event = await runInSavepointIfSupported(runner, async (sp) =>
          append(sp, {
            aggregateId: String(payload.id),
            aggregateType: entityName,
            tenantId: streamTenantFor(user, streamTenantId),
            expectedVersion: currentVersion,
            type: entityEventName(entityName, "deleted"),
            eventVersion,
            payload: {
              previous: await encryptForStorage(existing, user, {
                keyTenantId: streamTenantId,
                ...erasureSentinelOption(options),
              }),
            },
            metadata: buildEventMetadata(user),
          }),
        );
      } catch (e) {
        return await appendConflictFailure(e, runner, {
          entityId: payload.id,
          expectedVersion: currentVersion,
          streamTenant: streamTenantFor(user, streamTenantId),
        });
      }

      // Live==Rebuild via applyEntityEvent. Savepoint like create/update.
      const deleteResult = await runInSavepointIfSupported(
        withExecutorManagedWrites(runner),
        async (sp) => applyEntityEvent(event, table, entity, sp),
      );
      if (deleteResult.kind !== "applied") {
        return writeFailure(
          new InternalError({ message: "projection delete: applyEntityEvent skipped" }),
        );
      }

      await evictCachedEntity(user, streamTenantId, payload.id);

      const echoEvent = { ...event, payload: { previous: stripSensitive(existing) } };
      await projectEntityEvent(db, runner, echoEvent);

      return {
        isSuccess: true,
        data: {
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: echoEvent,
          ...(isLockGuardBypassed(user, options) && { lockGuardBypassed: true }),
        },
      };
    },

    // Hard-purge (Art. 17). Same shape as delete(), but emits `forgotten` which
    // hard-deletes the row regardless of softDelete — and, being an auto-verb,
    // the erasure replays on rebuild (created → forgotten → row gone). Loads
    // without the isDeleted filter so trashed (soft-deleted) rows are erased too.
    async forget(payload, user, db, options) {
      assertIrreversibleOperationAllowed(`${entityName}.forget`);
      const runner = tenantDbWriteRunner(db, "ctx.db executor forget");
      const raw = await db.fetchOne<Record<string, unknown>>(table, { id: payload.id });
      if (!raw) return writeFailure(new NotFoundError(entityName, payload.id));
      const unreadable = await unreadableRowFailure(
        payload.id,
        user,
        db,
        options?.parentVisibility,
      );
      if (unreadable) return unreadable;
      const streamTenantId = options?.streamTenantId;
      const streamTenantMismatch = streamTenantOverrideFailure(db, raw, streamTenantId);
      if (streamTenantMismatch) return streamTenantMismatch;
      const existing = await readProjectedRow(raw);

      if (
        !isFrameworkSystemUser(user) &&
        !userCanWriteFieldRow(
          ownershipSubject(user, streamTenantId),
          entity.access?.write,
          existing,
          existing,
        )
      ) {
        return ownershipDeniedFailure({
          scope: "entity",
          entityName,
          action: "delete",
          userId: user.id,
          entityId: payload.id,
        });
      }

      await assertStreamWritable(db, payload.id, streamTenantFor(user, streamTenantId));
      const currentVersion = await getStreamVersion(
        runner,
        String(payload.id),
        streamTenantFor(user, streamTenantId),
      );

      let event: AppendedEvent;
      try {
        event = await runInSavepointIfSupported(runner, async (sp) =>
          append(sp, {
            aggregateId: String(payload.id),
            aggregateType: entityName,
            tenantId: streamTenantFor(user, streamTenantId),
            expectedVersion: currentVersion,
            type: entityEventName(entityName, "forgotten"),
            eventVersion,
            // Re-encrypt like delete(): `existing` came decrypted from loadById —
            // plaintext must not land in the immutable log, least of all on forget.
            payload: {
              previous: await encryptForStorage(existing, user, {
                keyTenantId: streamTenantId,
                onErasedSubject: ErasedSubjectHandlings.sentinel,
              }),
            },
            metadata: buildEventMetadata(user),
          }),
        );
      } catch (e) {
        return await appendConflictFailure(e, runner, {
          entityId: payload.id,
          expectedVersion: currentVersion,
          streamTenant: streamTenantFor(user, streamTenantId),
        });
      }

      const forgetResult = await runInSavepointIfSupported(
        withExecutorManagedWrites(runner),
        async (sp) => applyEntityEvent(event, table, entity, sp),
      );
      if (forgetResult.kind !== "applied") {
        return writeFailure(
          new InternalError({ message: "projection forget: applyEntityEvent skipped" }),
        );
      }

      await evictCachedEntity(user, streamTenantId, payload.id);

      const echoEvent = { ...event, payload: { previous: stripSensitive(existing) } };
      await projectEntityEvent(db, runner, echoEvent);

      return {
        isSuccess: true,
        data: {
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: echoEvent,
          lockGuardBypassed: true,
        },
      };
    },

    async restore(payload, user, db, options) {
      if (!softDelete) {
        return writeFailure(
          new UnprocessableError("soft_delete_not_enabled", {
            i18nKey: "errors.softDeleteNotEnabled",
          }),
        );
      }
      const runner = tenantDbWriteRunner(db, "ctx.db executor restore");
      const streamTenantId = options?.streamTenantId;
      // Before loadSoftDeletedRow: its not_deleted answer would confirm that an unreadable
      // live row exists.
      const unreadable = await unreadableRowFailure(
        payload.id,
        user,
        db,
        options?.parentVisibility,
      );
      if (unreadable) return unreadable;
      const target = await loadSoftDeletedRow(db, payload.id, streamTenantId);
      if ("failure" in target) return target.failure;
      const data = target.row;

      // H.2 — entity-level write-ownership on restore. Same shape as delete:
      // only the stored row matters. Stored row carries pre-soft-delete
      // teamId/... fields, so the ownership predicate still applies cleanly.
      if (
        !userCanWriteFieldRow(
          ownershipSubject(user, streamTenantId),
          entity.access?.write,
          data,
          data,
        )
      ) {
        return ownershipDeniedFailure({
          scope: "entity",
          entityName,
          action: "restore",
          userId: user.id,
          entityId: payload.id,
        });
      }

      await assertStreamWritable(db, payload.id, streamTenantFor(user, streamTenantId));

      // Stream-version authoritative (see update() for rationale).
      const currentVersion = await getStreamVersion(
        runner,
        String(payload.id),
        streamTenantFor(user, streamTenantId),
      );
      // Restore carries the soft-deleted snapshot as `previous` — mirror of
      // delete for symmetry. Projections that decremented on delete use
      // `previous` to re-increment on restore without re-querying the entity
      // table. Rows predating the subject-KMS rollout may still hold plaintext
      // pii, and envelope encryption is not idempotent: decrypt, then
      // re-encrypt as delete does.
      const previousPlain = await decryptForRead(rehydrateCompoundTypes(data, entity));
      const appended = await appendRestoredEvent(
        runner,
        user,
        payload.id,
        previousPlain,
        streamTenantId,
        currentVersion,
      );
      if ("failure" in appended) return appended.failure;
      const event = appended.event;

      // Live==Rebuild via applyEntityEvent. Restore only writes isDeleted=false
      // plus the version bump, so there is no sensitive-field drift and no
      // payload override is needed.
      // Soft-delete unique indexes are partial (WHERE is_deleted = false), so a live row may have re-taken the value this restore brings back.
      const projected = await applyProjection(runner, event, "projection restore returned no row");
      if ("failure" in projected) return projected.failure;

      await evictCachedEntity(user, streamTenantId, payload.id);

      // Read-side auto-convert for compound types, same as update/list.
      // decryptForRead matches create/update/list/detail: the caller-facing
      // row and `previous` snapshot must be plaintext for `encrypted` fields,
      // same as every other executor method — `data`/`restored` are raw rows
      // (db.fetchOne / applyEntityEvent), never decrypted before this point.
      const restoredHydrated = await readProjectedRow(projected.row);

      const echoEvent = { ...event, payload: { previous: stripSensitive(previousPlain) } };
      await projectEntityEvent(db, runner, echoEvent);
      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: payload.id,
          data: restoredHydrated,
          changes: { isDeleted: false },
          previous: previousPlain,
          isNew: false,
          entityName,
          event: echoEvent,
        },
      };
    },
  };
}
