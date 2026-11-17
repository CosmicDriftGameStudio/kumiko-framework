import type {
  ExecutorCreateOptions,
  ExecutorSaveContext,
  ExecutorUpdateOptions,
  ParentVisibilityOption,
} from "@cosmicdrift/kumiko-types/event-store-executor-types";
import { isDeclaredEntityVerb } from "@cosmicdrift/kumiko-types/fields";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { ZodType } from "zod";
import {
  type ErasedSubjectHandling,
  ErasedSubjectHandlings,
} from "../crypto/pii-field-encryption.ts";
import { fieldsAwaitingApproval } from "../engine/field-approval.ts";
import { instructionFieldNames } from "../engine/instruction-fields.ts";
import { userCanWriteFieldRow } from "../engine/ownership.ts";
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
  FrameworkReasons,
  VersionConflictError as FrameworkVersionConflict,
  InternalError,
  NotFoundError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "../errors/index.ts";
import { isSubjectErasedConflict } from "../errors/subject-erased.ts";
import { buildInvalidTransitionDetails } from "../errors/transition-details.ts";
import {
  ArchivedStreamError,
  IdempotentAppendConflictError as EventStoreIdempotentAppendConflict,
} from "../event-store/errors.ts";
import type { EventToAppend } from "../event-store/event-store.ts";
import {
  append,
  VersionConflictError as EventStoreVersionConflict,
  getStreamVersion,
} from "../event-store/index.ts";

import { resolveFileHandles } from "../files/resolve-file-handles.ts";
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
  createBatchWriteVerbs,
  type PreparedCreate,
  type PreparedUpdate,
} from "./event-store-executor-write-many.ts";
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
import { tenantDbWriteRunnerForTable } from "./tenant-db-runner.ts";
import { createOwnershipFailure, updateOwnershipFailure } from "./write-ownership-failures.ts";

type WriteRunner = ReturnType<typeof tenantDbWriteRunnerForTable>;
type AppendedEvent = Awaited<ReturnType<typeof append>>;
type UpdateOptions = Parameters<EventStoreExecutor["update"]>[3];

// The five write verbs (create/update/delete/forget/restore) of the event-
// store-executor, split out of event-store-executor.ts. They read an explicit
// ExecutorContext instead of capturing the factory's local scope directly.

export function createWriteVerbs(
  ctx: ExecutorContext,
): Pick<
  EventStoreExecutor,
  "create" | "update" | "delete" | "forget" | "restore" | "createMany" | "updateMany"
> {
  const {
    table,
    entity,
    entityName,
    softDelete,
    streamTenantFor,
    streamTenantOverrideFailure,
    streamTenantCreateFailure,
    encryptForStorage,
    decryptForRead,
    ownerTransitionRekeys,
    applyDefaults,
    stripSensitive,
    assertStreamWritable,
    isRowReadable,
    loadWriteSnapshot,
    assertExpectKeysComparable,
    expectColumnOf,
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
    runner: ReturnType<typeof tenantDbWriteRunnerForTable>,
    aggregateId: string,
    tenantId: TenantId,
  ): Promise<number> {
    try {
      return await getStreamVersion(runner, aggregateId, tenantId);
    } catch {
      return -1;
    }
  }

  // Compares the `expect:` fields against the raw row of the write snapshot.
  function expectMismatchFailure(
    rawRow: Readonly<Record<string, unknown>>,
    id: EntityId,
    expect: Readonly<Record<string, unknown>>,
  ): WriteFailure | undefined {
    assertExpectKeysComparable(Object.keys(expect));
    const mismatch = Object.entries(expect).find(
      ([key, expected]) => rawRow[expectColumnOf(key)] !== expected,
    );
    return mismatch
      ? writeFailure(new PreconditionFailedError({ entityId: id, field: mismatch[0] }))
      : undefined;
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

  function fieldApprovalFailure(
    user: SessionUser,
    data: DbRow,
    previous: DbRow | undefined,
  ): WriteFailure | undefined {
    // Framework system writes (seeds, retention, forget) are trusted code, not a second person's decision.
    if (isFrameworkSystemUser(user)) return undefined;
    const fields = fieldsAwaitingApproval(entity, user, data, previous);
    if (fields.length === 0) return undefined;
    return writeFailure(
      new AccessDeniedError({
        message: `${entityName}: ${fields.join(", ")} change only through an approved field-approval request`,
        i18nKey: "errors.access.fieldApprovalRequired",
        details: {
          reason: FrameworkReasons.fieldApprovalRequired,
          entity: entityName,
          fields,
        },
      }),
    );
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

  // Append and projection share one savepoint: Postgres aborts the WHOLE surrounding transaction
  // once any statement inside it errors, even if the JS error is caught, so a losing writer's
  // unique violation or a failed projection write must roll back in a nested scope. A bare pool
  // connection (seeds/tests calling the executor directly) has no transaction to poison and
  // gets a plain call. flat event payloads are table ciphertext for pii/encrypted fields, so the
  // immutable log never sees plaintext. A create with a deterministic id can collide with an
  // existing stream: that is version_conflict, not internal_error. Application-level unique
  // violations of the projection (e.g. (tenantId, email)) become 409 unique_violation.
  async function appendAndApply(
    runner: WriteRunner,
    toAppend: EventToAppend,
    noRowMessage: string,
  ): Promise<
    { readonly event: AppendedEvent; readonly row: DbRow } | { readonly failure: WriteFailure }
  > {
    let committed: { event: AppendedEvent; applied: Awaited<ReturnType<typeof applyEntityEvent>> };
    try {
      committed = await runInSavepointIfSupported(withExecutorManagedWrites(runner), async (sp) => {
        const event = await append(sp, toAppend);
        const applied = await applyEntityEvent(event, table, entity, sp);
        return { event, applied };
      });
    } catch (e) {
      const mapped = tryMapUniqueViolation(e, entityName);
      if (mapped) return { failure: mapped };
      return {
        failure: await appendConflictFailure(e, runner, {
          entityId: toAppend.aggregateId,
          expectedVersion: toAppend.expectedVersion,
          streamTenant: toAppend.tenantId,
        }),
      };
    }
    const { event, applied } = committed;
    if (applied.kind !== "applied" || applied.row === null) {
      return { failure: writeFailure(new InternalError({ message: noRowMessage })) };
    }
    return { event, row: applied.row };
  }

  // Update the projection through applyEntityEvent — the same code path used by
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

    // previous carries the old values of exactly the keys this event changes (owner-transition
    // rekeys included), so a projection can still undo a moved FK; the whole row grew every
    // update by the record size (long text, jsonb). Encrypted with the full pre-update row as
    // subject source so an unchanged owner still resolves. `previous` came from
    // loadWriteSnapshot(), which decrypts, so it must be re-encrypted before it is persisted.
    // Owner chain for the ownerless-then-assigned row: previous owner, then
    // the owner this event sets, then whenAbsent.
    const changedPrevious = Object.fromEntries(
      Object.keys(changesToPersist)
        .filter((key) => key in previous)
        .map((key) => [key, previous[key]]),
    );
    const encryptedPrevious = await encryptForStorage(changedPrevious, user, {
      subjectSource: previous,
      keyTenantId: streamTenantId,
      ownerFallback: submittedChanges,
      ...erasureSentinelOption(options),
    });
    return { flatChangesPlain, flatChanges, encryptedPrevious, changedPrevious };
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

  async function prepareCreate(
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
    options: ExecutorCreateOptions | undefined,
  ): Promise<WriteFailure | PreparedCreate> {
    assertTenantAllowedOnGlobalEntity("create", "payload.tenantId", payload["tenantId"]);
    const streamTenantId = options?.streamTenantId;
    const streamTenantMismatch = streamTenantCreateFailure(db, payload, streamTenantId);
    if (streamTenantMismatch) return streamTenantMismatch;
    // Respect an explicit id in the payload (seed pattern, SCIM import). Without
    // one the framework mints a fresh UUIDv7 via generateId. Strip it out of the
    // event payload so defaults + downstream consumers don't see a redundant id field.
    const explicitId = typeof payload["id"] === "string" ? (payload["id"] as string) : undefined; // @cast-boundary engine-payload
    const aggregateId = explicitId ?? generateId();
    const { id: _id, ...payloadWithHandles } = payload;
    const handles = await resolveFileHandles(entity, entityName, payloadWithHandles, db, user);
    if ("failure" in handles) return handles.failure;
    const payloadWithoutId = handles.values;
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
    const approvalRequired = fieldApprovalFailure(user, data, undefined);
    if (approvalRequired) return approvalRequired;
    const ownershipDenied = createOwnershipFailure({
      entity,
      entityName,
      user,
      streamTenantId,
      payloadWithoutId,
      data,
      applyDefaults,
    });
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
    const streamTenant = streamTenantFor(user, streamTenantId);
    return {
      aggregateId,
      streamTenantId,
      streamTenant,
      data,
      flatCreateData,
      claimedFileRefIds: handles.claimedFileRefIds,
      toAppend: {
        aggregateId,
        aggregateType: entityName,
        tenantId: streamTenant,
        expectedVersion: 0,
        type: entityEventName(entityName, "created"),
        eventVersion,
        payload: flatData,
        metadata: buildEventMetadata(user),
      },
    };
  }

  async function finishCreate(
    db: TenantDb,
    runner: WriteRunner,
    prepared: PreparedCreate,
    event: AppendedEvent,
    row: DbRow,
  ): Promise<ExecutorSaveContext> {
    const projection = await readProjectedRow(row);
    // The echoed event is the one projections see (and the dispatcher later
    // skips), so build it before projecting. The persisted event carries ciphertext by
    // design; the caller-facing echo must be plaintext like every other response field.
    const echoEvent = { ...event, payload: stripSensitive(prepared.flatCreateData) };
    await projectEntityEvent(db, runner, echoEvent);
    return {
      kind: "save",
      id: prepared.aggregateId,
      data: projection,
      changes: prepared.data,
      previous: {},
      isNew: true,
      entityName,
      event: echoEvent,
      claimedFileRefIds: prepared.claimedFileRefIds,
    };
  }

  async function prepareUpdate(
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    updateOptions: ExecutorUpdateOptions | undefined,
  ): Promise<WriteFailure | PreparedUpdate> {
    assertTenantAllowedOnGlobalEntity(
      "update",
      "payload.changes.tenantId",
      payload.changes["tenantId"],
    );
    const streamTenantId = updateOptions?.streamTenantId;
    const streamTenant = streamTenantFor(user, streamTenantId);
    const snapshot = await loadWriteSnapshot(db, payload.id, user, {
      includeDeleted: updateOptions?.includeDeleted === true,
      streamTenant,
      parentVisibility: updateOptions?.parentVisibility,
    });
    if (snapshot.row === null) return writeFailure(new NotFoundError(entityName, payload.id));
    const previous = snapshot.row;
    const streamTenantMismatch = streamTenantOverrideFailure(db, previous, streamTenantId);
    if (streamTenantMismatch) return streamTenantMismatch;
    const handles = await resolveFileHandles(entity, entityName, payload.changes, db, user);
    if ("failure" in handles) return handles.failure;
    const submittedChanges: DbRow = { ...handles.values };
    const preSaveResult = await runPreSave(
      updateOptions?.preSave,
      submittedChanges,
      previous,
      false,
      entityName,
      "update",
      updateOutputSchema,
    );
    if ("failure" in preSaveResult) return preSaveResult.failure;
    const changes = preSaveResult.data;

    const verbName = updateOptions?.verb;
    const verbDef = verbName === undefined ? undefined : entity.verbs?.[verbName];
    if (
      verbName !== undefined &&
      (verbDef === undefined || !isDeclaredEntityVerb(entity, verbName))
    ) {
      throw new InternalError({
        message: `update: verb "${verbName}" is not declared in verbs of entity "${entityName}"`,
      });
    }
    const transition = verbDef?.transition;
    let verbChanges: Record<string, unknown> = changes;
    if (transition !== undefined) {
      const submitted = changes[transition.field];
      if (submitted !== undefined && submitted !== transition.to) {
        throw new InternalError({
          message: `update with verb "${verbName}" on "${entityName}": changes.${transition.field} is ${JSON.stringify(submitted)}, the verb sets "${transition.to}"`,
        });
      }
      const current = previous[transition.field];
      if (typeof current !== "string" || !transition.from.includes(current)) {
        return writeFailure(
          new UnprocessableError(FrameworkReasons.invalidTransition, {
            i18nKey: "errors.invalidTransition",
            details: buildInvalidTransitionDetails(String(current ?? ""), transition.to, []),
          }),
        );
      }
      verbChanges = { ...changes, [transition.field]: transition.to };
    }

    assertFieldWritesAllowed(db, "update", verbChanges);
    const approvalRequired = fieldApprovalFailure(user, verbChanges, previous);
    if (approvalRequired) return approvalRequired;

    const mergedNew: Record<string, unknown> = { ...previous, ...verbChanges };
    const guardFailure =
      updateOwnershipFailure({
        entity,
        entityName,
        user,
        streamTenantId,
        id: payload.id,
        submittedChanges,
        previous,
        changes: verbChanges,
        mergedNew,
      }) ??
      recordLockedFailure(previous, payload.id, user, updateOptions) ??
      updateSelectOptionFailure(user, mergedNew, previous, updateOptions);
    if (guardFailure) return guardFailure;

    if (snapshot.archived) throw new ArchivedStreamError(streamTenant, String(payload.id));

    if (updateOptions?.expect) {
      const expectFailure = expectMismatchFailure(
        snapshot.rawRow,
        payload.id,
        updateOptions.expect,
      );
      if (expectFailure) return expectFailure;
    }
    const currentVersion = snapshot.streamVersion;

    const versionConflict = optimisticLockFailure(
      payload.id,
      payload.version,
      currentVersion,
      updateOptions?.skipOptimisticLock,
    );
    if (versionConflict) return versionConflict;

    const { flatChangesPlain, flatChanges, encryptedPrevious, changedPrevious } =
      await encryptUpdatePayload(user, streamTenantId, previous, verbChanges, mergedNew, updateOptions);
    return {
      id: payload.id,
      previous,
      changes: verbChanges,
      changedPrevious,
      flatChangesPlain,
      streamTenant,
      currentVersion,
      claimedFileRefIds: handles.claimedFileRefIds,
      toAppend: {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: streamTenant,
        expectedVersion: currentVersion,
        type:
          verbName === undefined ? entityEventName(entityName, "updated") : `${entityName}.${verbName}`,
        eventVersion,
        payload: { changes: flatChanges, previous: encryptedPrevious },
        metadata: buildEventMetadata(user),
      },
    };
  }

  async function finishUpdate(
    db: TenantDb,
    runner: WriteRunner,
    prepared: PreparedUpdate,
    event: AppendedEvent,
    row: DbRow,
  ): Promise<ExecutorSaveContext> {
    const data = await readProjectedRow(row);
    const echoEvent = {
      ...event,
      payload: {
        changes: stripSensitive(prepared.flatChangesPlain),
        previous: stripSensitive(prepared.changedPrevious),
      },
    };
    await projectEntityEvent(db, runner, echoEvent);
    return {
      kind: "save",
      id: String(prepared.id),
      data,
      changes: prepared.changes,
      // The caller still gets the whole pre-update row; only the stored event is lean.
      previous: prepared.previous,
      isNew: false,
      entityName,
      event: echoEvent,
      claimedFileRefIds: prepared.claimedFileRefIds,
    };
  }

  return {
    ...createBatchWriteVerbs({
      table,
      entity,
      entityName,
      prepareCreate,
      prepareUpdate,
      finishCreate,
      finishUpdate,
      appendConflictFailure,
    }),
    async create(payload, user, db, options) {
      const runner = tenantDbWriteRunnerForTable(db, "ctx.db executor create", table);
      const prepared = await prepareCreate(payload, user, db, options);
      if ("isSuccess" in prepared) return prepared;
      const applied = await appendAndApply(
        runner,
        prepared.toAppend,
        "projection insert returned no row",
      );
      if ("failure" in applied) return applied.failure;
      return {
        isSuccess: true,
        data: await finishCreate(db, runner, prepared, applied.event, applied.row),
      };
    },

    async update(payload, user, db, updateOptions) {
      const runner = tenantDbWriteRunnerForTable(db, "ctx.db executor update", table);
      const prepared = await prepareUpdate(payload, user, db, updateOptions);
      if ("isSuccess" in prepared) return prepared;
      try {
        const applied = await appendAndApply(
          runner,
          prepared.toAppend,
          "projection update returned no row",
        );
        if ("failure" in applied) return applied.failure;
        return {
          isSuccess: true,
          data: await finishUpdate(db, runner, prepared, applied.event, applied.row),
        };
      } catch (e) {
        // The pre-check in prepareUpdate eliminates the common stale-version case; this
        // branch catches the narrow race where two writers both read version=N
        // and both pass the local check — the unique index on (aggregate_id,
        // version) serializes them, one wins, the other lands here.
        return await appendConflictFailure(e, runner, {
          entityId: payload.id,
          expectedVersion: prepared.currentVersion,
          streamTenant: prepared.streamTenant,
        });
      }
    },

    async delete(payload, user, db, options) {
      if (isIrreversibleEntityVerb("delete", entity)) {
        assertIrreversibleOperationAllowed(`${entityName}.delete (entity has no softDelete)`);
      }
      const runner = tenantDbWriteRunnerForTable(db, "ctx.db executor delete", table);
      const streamTenantId = options?.streamTenantId;
      const streamTenant = streamTenantFor(user, streamTenantId);
      const snapshot = await loadWriteSnapshot(db, payload.id, user, {
        streamTenant,
        parentVisibility: options?.parentVisibility,
      });
      if (snapshot.row === null) return writeFailure(new NotFoundError(entityName, payload.id));
      const existing = snapshot.row;
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

      if (snapshot.archived) throw new ArchivedStreamError(streamTenant, String(payload.id));

      if (options?.expect) {
        const expectFailure = expectMismatchFailure(snapshot.rawRow, payload.id, options.expect);
        if (expectFailure) return expectFailure;
      }
      // Stream version from the snapshot, not row.version: ctx.events.append can bump the
      // stream without touching the row.
      const currentVersion = snapshot.streamVersion;

      // Deletes carry the full pre-delete row as `previous`. That's what
      // projections and downstream consumers need to reverse any aggregates —
      // a `{}`-payload delete would make cross-aggregate projections impossible
      // to rebuild from the event log alone. `existing` came from loadWriteSnapshot(),
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
      const runner = tenantDbWriteRunnerForTable(db, "ctx.db executor forget", table);
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
            // Re-encrypt like delete(): `existing` came decrypted from readProjectedRow —
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
      const runner = tenantDbWriteRunnerForTable(db, "ctx.db executor restore", table);
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
          id: String(payload.id),
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
