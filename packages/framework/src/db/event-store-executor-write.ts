import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { ZodType } from "zod";
import { checkWriteFieldOwnership } from "../engine/field-access.ts";
import { instructionFieldNames } from "../engine/instruction-fields.ts";
import { userCanCreateFieldRow, userCanWriteFieldRow } from "../engine/ownership.ts";
import { buildInsertSchema, buildUpdateSchema } from "../engine/schema-builder.ts";
import {
  findUnavailableSelectOptions,
  isRecordLocked,
  isUnchangedValue,
  type UnavailableSelectOption,
} from "../engine/screen-helpers.ts";
import type { EntityId, SessionUser, TenantId } from "../engine/types/index.ts";
import {
  AccessDeniedError,
  VersionConflictError as FrameworkVersionConflict,
  IdempotentReplayError,
  InternalError,
  isSubjectErasedConflict,
  NotFoundError,
  PreconditionFailedError,
  RecordLockedError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "../errors/index.ts";
import {
  append,
  IdempotentAppendConflictError as EventStoreIdempotentAppendConflict,
  VersionConflictError as EventStoreVersionConflict,
  getStreamVersion,
  type StoredEvent,
} from "../event-store/index.ts";
import {
  assertInstructionFieldWriteAllowed,
  assertIrreversibleOperationAllowed,
  isIrreversibleEntityVerb,
} from "../pipeline/irreversible-operation-gate.ts";
import {
  hasLiveProjectionsForEvent,
  runProjectionsForEvent,
} from "../pipeline/projections-runner.ts";
import { generateId } from "../utils/index.ts";
import { applyEntityEvent } from "./apply-entity-event.ts";
import { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types.ts";
import type { DbRow, DbRunner } from "./connection.ts";
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
import { isFrameworkSystemUser, isLockGuardBypassed } from "./lock-guard.ts";
import { projectionRegistryOf } from "./projection-registry-binding.ts";
import { runInSavepointIfSupported } from "./query.ts";
import { assertPersonalDataWrite, tableNameOf, withExecutorManagedWrites } from "./tenant-db.ts";
import { tenantDbWriteRunner } from "./tenant-db-runner.ts";

// The echoed event carries entity PII and must never reach a handler's JSON response, while
// hooks and projections still read it by property. Non-enumerable keeps it out of spread/stringify.
function withoutEventInJson<T extends { readonly event: unknown }>(result: T): T {
  return Object.defineProperty(result, "event", { value: result.event, enumerable: false });
}

// Custom projections for a write that did not go through the dispatcher (hook or
// job writing a second aggregate). Savepoint like applyEntityEvent: a throwing
// projection fails the write and the caller's transaction rolls it back.
async function projectEntityEvent(
  db: TenantDb,
  runner: DbRunner,
  event: StoredEvent,
): Promise<void> {
  const registry = projectionRegistryOf(db);
  // skip: TenantDb not built by a dispatcher/job runner — nothing bound to project with
  if (!registry) return;
  // skip: no live projection listens — avoid a SAVEPOINT round trip on every plain write
  if (!hasLiveProjectionsForEvent(event, registry)) return;
  await runInSavepointIfSupported(runner, (sp) => runProjectionsForEvent(event, registry, sp));
}

// The five write verbs (create/update/delete/forget/restore) of the event-
// store-executor. Split out of event-store-executor.ts —
// behavior-preserving relocation, not a redesign: every closure below is
// unchanged from the original, just relocated behind an explicit
// ExecutorContext instead of capturing the factory's local scope directly.

function selectOptionNotAvailableFailure(entries: readonly UnavailableSelectOption[]) {
  const [first] = entries;
  if (!first) return undefined;
  const i18nKey = "kumiko.validation.optionNotAvailable";
  return writeFailure(
    new UnprocessableError("select_option_not_available", {
      i18nKey,
      details: {
        field: first.field,
        value: first.value,
        allowed: first.allowed,
        fields: entries.map((entry) => ({
          path: entry.field,
          code: "select_option_not_available",
          i18nKey,
          params: { allowed: entry.allowed },
        })),
      },
    }),
  );
}

type PreSaveFn = (
  changes: Record<string, unknown>,
  previous: Record<string, unknown>,
  isNew: boolean,
) => Promise<Record<string, unknown>>;

// preSave runs before ownership checks: authorization must evaluate the row
// as it will actually be persisted, including hook-derived fields. A throwing
// hook is an app-author bug (bad business rule, not a framework fault) — map it
// to a clean writeFailure instead of letting it propagate as an internal_error
// 500.
async function runPreSave(
  preSave: PreSaveFn | undefined,
  changes: Record<string, unknown>,
  previous: Record<string, unknown>,
  isNew: boolean,
  entityName: string,
  action: "create" | "update",
  outputSchema: () => ZodType,
): Promise<{ readonly data: DbRow } | { readonly failure: ReturnType<typeof writeFailure> }> {
  if (!preSave) return { data: changes as DbRow };
  try {
    const hookResult = await preSave(changes, previous, isNew);
    // A hook that echoes `id`/`version` back (e.g. `{ ...changes, id: x }`)
    // must not leak them into the persisted row — aggregateId already comes
    // from generateId()/the loaded row, not from hook output.
    const { id: _hookId, version: _hookVersion, ...safe } = hookResult;
    // Hook output skips the handler's input validation yet goes straight into the projection.
    // Validated only, not replaced by the parse result: hooks may set fields in storage form.
    const parsed = outputSchema().safeParse(safe);
    if (!parsed.success) {
      return {
        failure: writeFailure(
          new UnprocessableError("presave_hook_invalid_output", {
            i18nKey: "errors.presaveHookInvalidOutput",
            details: {
              entityName,
              action,
              handler: `${entityName}:${action}`,
              issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
          }),
        ),
      };
    }
    return { data: safe as DbRow };
  } catch (e) {
    return {
      failure: writeFailure(
        new UnprocessableError("presave_hook_failed", {
          i18nKey: "errors.presaveHookFailed",
          details: { entityName, action, message: e instanceof Error ? e.message : String(e) },
        }),
      ),
    };
  }
}

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
    loadExpectSnapshot,
  } = ctx;
  const entityInstructionFieldNames = instructionFieldNames(entity);

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
  ): { readonly onErasedSubject: "sentinel" } | Record<string, never> {
    return options?.writePurpose === WritePurposes.erasure ? { onErasedSubject: "sentinel" } : {};
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
    runner: ReturnType<typeof tenantDbWriteRunner>,
    user: SessionUser,
    id: EntityId,
    previousPlain: DbRow,
    streamTenantId: TenantId | undefined,
    currentVersion: number,
  ): Promise<
    { readonly event: Awaited<ReturnType<typeof append>> } | { readonly failure: WriteFailure }
  > {
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
      if (e instanceof EventStoreVersionConflict) {
        return {
          failure: writeFailure(
            new FrameworkVersionConflict({
              entityId: id,
              expectedVersion: currentVersion,
              currentVersion: await versionAfterConflict(
                runner,
                String(id),
                streamTenantFor(user, streamTenantId),
              ),
            }),
          ),
        };
      }
      if (e instanceof EventStoreIdempotentAppendConflict) {
        return {
          failure: writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey })),
        };
      }
      throw e;
    }
  }

  // After a lost append race the stream version read before the append is stale;
  // report the actual one. -1 when the lookup itself fails.
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

  return {
    async create(payload, user, db, options) {
      if (isForeignTenantOnGlobalEntity(entity, payload["tenantId"])) {
        throw new AccessDeniedError({
          message:
            `${entityName}.create: entity is tenancy: "global" — payload.tenantId must be ` +
            "SYSTEM_TENANT_ID or omitted.",
        });
      }
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

      // After preSave so derived fields count, before the event append so nothing persists.
      assertPersonalDataWrite(db, tableNameOf(table), Object.keys(data), entity);
      assertInstructionFieldWriteAllowed(
        entityName,
        "create",
        Object.keys(data),
        entityInstructionFieldNames,
      );

      // H.2 — entity-level write-ownership on create. No oldRow exists, so
      // only the new row is checked. No Straddle concern for creates.
      if (
        !userCanCreateFieldRow(ownershipSubject(user, streamTenantId), entity.access?.write, data)
      ) {
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

      const unavailableOnCreate = selectOptionNotAvailableFailure(
        findUnavailableSelectOptions(entity.fields, data),
      );
      if (unavailableOnCreate) return unavailableOnCreate;

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

      // 1. Append the event in the same transaction as the projection write — both must
      //    succeed or both roll back; the dispatcher wraps them in one transaction.
      //    flatData is already table ciphertext for pii/encrypted fields, so the immutable
      //    log never sees plaintext and replay reproduces the row byte-for-byte.
      //
      //    `expectedVersion: 0` means the stream does not yet exist. With deterministic
      //    aggregate-ID patterns (for example, uuidv5(tenantId|naturalKey)), a create can
      //    legitimately collide — the same ID has an existing stream — so return
      //    version_conflict instead of internal_error. Update uses the same catch.
      let event: Awaited<ReturnType<typeof append>>;
      try {
        // Savepoint-scoped: postgres.js poisons the WHOLE surrounding
        // begin() once any statement inside it errors, even if the JS error
        // is caught — a losing concurrent create's unique-violation
        // would otherwise abort the caller's outer transaction and surface as
        // internal_error at commit time instead of the version_conflict this
        // catch classifies. runInSavepointIfSupported confines the failed
        // INSERT to a nested scope that rolls back on its own (same pattern as
        // ctx.tryAppendEvent), and falls back to a plain call when the runner
        // is a bare pool connection with no active transaction to poison
        // (seeds/tests calling the executor directly).
        event = await runInSavepointIfSupported(runner, async (sp) =>
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
      } catch (e) {
        if (e instanceof EventStoreVersionConflict) {
          const currentVersion = await versionAfterConflict(
            runner,
            aggregateId,
            streamTenantFor(user, streamTenantId),
          );
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: aggregateId,
              expectedVersion: 0,
              currentVersion,
            }),
          );
        }
        if (e instanceof EventStoreIdempotentAppendConflict) {
          return writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey }));
        }
        throw e;
      }

      // 2. Update the projection through applyEntityEvent — the same code path used by
      //    rebuildProjection for replay, with the same StoredEvent, so live and rebuild
      //    produce the same result by construction.
      //
      //    Application-level unique violations (for example, (tenantId, email) on a User
      //    entity or (tenantId, slug) on an Article) produce pg-23505 from the projection
      //    INSERT. Without this catch, the error propagates as an unhandled exception and
      //    becomes a 500 internal_error. Map it to UniqueViolationError 409 so the
      //    designer/frontend can show a clear "duplicate" message instead of a cryptic
      //    "internal server error".
      // Savepoint like the append above: an unclassified DB error from the projection
      // INSERT would otherwise poison the enclosing transaction (postgres-js rejects the
      // whole begin() once any statement in it fails). The savepoint rolls back the failed
      // INSERT while allowing the error to propagate and remain catchable.
      let result: Awaited<ReturnType<typeof applyEntityEvent>>;
      try {
        result = await runInSavepointIfSupported(withExecutorManagedWrites(runner), async (sp) =>
          applyEntityEvent(event, table, entity, sp),
        );
      } catch (e) {
        const mapped = tryMapUniqueViolation(e, entityName);
        if (mapped) return mapped;
        throw e;
      }
      if (result.kind !== "applied" || result.row === null) {
        return writeFailure(new InternalError({ message: "projection insert returned no row" }));
      }
      const row = result.row;
      // Read-side conversion: DB form → combined API form for all
      // compound types in one pass.
      const projection = await decryptForRead(
        rehydrateCompoundTypes(row as DbRow, entity) as DbRow,
      );

      if (entityCache && entityName) {
        await entityCache.del(streamTenantId ?? user.tenantId, entityName, aggregateId);
      }

      // The echoed event is the one projections see (and the dispatcher later
      // skips), so build it before projecting.
      const echoEvent = { ...event, payload: stripSensitive(flatCreateData) };
      await projectEntityEvent(db, runner, echoEvent);

      return {
        isSuccess: true,
        data: withoutEventInJson({
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
        }),
      };
    },

    async update(payload, user, db, updateOptions) {
      const runner = tenantDbWriteRunner(db, "ctx.db executor update");
      if (isForeignTenantOnGlobalEntity(entity, payload.changes["tenantId"])) {
        throw new AccessDeniedError({
          message:
            `${entityName}.update: entity is tenancy: "global" — payload.changes.tenantId must ` +
            "be SYSTEM_TENANT_ID or omitted.",
        });
      }
      const previous = await loadById(payload.id, db, {
        includeDeleted: updateOptions?.includeDeleted === true,
      });
      if (!previous) return writeFailure(new NotFoundError(entityName, payload.id));
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

      // After preSave so derived fields count, before the event append so nothing persists.
      assertPersonalDataWrite(db, tableNameOf(table), Object.keys(changes), entity);
      assertInstructionFieldWriteAllowed(
        entityName,
        "update",
        Object.keys(changes),
        entityInstructionFieldNames,
      );

      // H.2 — entity-level write-ownership on update. Load old row (already
      // done above), build post-change row via shallow merge. Straddle-safe
      // multi-role check: at least one role must accept BOTH old and new —
      // prevents the attack where role A passes old, role B passes new and
      // aggregation would wrongly allow a row-grab.
      const mergedNew: Record<string, unknown> = { ...previous, ...changes };
      if (
        !userCanWriteFieldRow(
          ownershipSubject(user, streamTenantId),
          entity.access?.write,
          previous,
          mergedNew,
        )
      ) {
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
        payload.changes,
        ownershipSubject(user, streamTenantId),
        previous,
        changes,
      );
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

      const lockedUpdate = recordLockedFailure(previous, payload.id, user, updateOptions);
      if (lockedUpdate) return lockedUpdate;

      // Statutory retention/erasure writes may change a condition field (e.g. null a PII
      // reference) and must not be blocked by the select rule — same exemption as the lock.
      const isStatutorySystemWrite =
        updateOptions?.writePurpose !== undefined && isFrameworkSystemUser(user);
      const unavailableOnUpdate = isStatutorySystemWrite
        ? undefined
        : selectOptionNotAvailableFailure(
            findUnavailableSelectOptions(entity.fields, mergedNew, previous),
          );
      if (unavailableOnUpdate) return unavailableOnUpdate;

      const streamTenant = streamTenantFor(user, streamTenantId);
      await assertStreamWritable(db, payload.id, streamTenant);

      // Stream-version is authoritative, not row.version. `ctx.appendEvent`
      // can bump the stream between CRUD writes (domain event on the same
      // aggregate); a stale row.version here would make the next CRUD write
      // trip `events_aggregate_version_uq` (tenant_id, aggregate_id, version)
      // with version_conflict.
      //
      // With `expect:` the version comes from loadExpectSnapshot's combined
      // query instead; see its comment for why.
      const expect = updateOptions?.expect;
      const currentVersion = expect
        ? await expectedStreamVersion(db, payload.id, streamTenant, expect)
        : await getStreamVersion(runner, String(payload.id), streamTenant);
      if (typeof currentVersion !== "number") return currentVersion;

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
        // Compound-type conversion in one pass.
        // subjectSource: partial changes may carry a pii field without its
        // ownerField — the merged row still identifies the subject.
        // skipUnchanged is opt-in: an identical resubmitted key is dropped before
        // encryption so pii/encrypted fields receive no fresh ciphertext when nothing
        // actually changed.
        // Direct callers (KEK rotation, backfill) rely on the default to force re-encryption.
        const submittedChanges = updateOptions?.skipUnchanged
          ? Object.fromEntries(
              Object.entries(changes).filter(
                ([key, value]) => !isUnchangedValue(value, previous[key]),
              ),
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
          ...erasureSentinelOption(updateOptions),
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
          ...erasureSentinelOption(updateOptions),
        });
        // Savepoint-scoped — see the create() append() above for why:
        // confines a losing writer's unique-violation to a nested scope
        // instead of poisoning the whole outer transaction.
        const event = await runInSavepointIfSupported(runner, (sp) =>
          append(sp, {
            aggregateId: String(payload.id),
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
        let result: Awaited<ReturnType<typeof applyEntityEvent>>;
        try {
          result = await runInSavepointIfSupported(withExecutorManagedWrites(runner), async (sp) =>
            applyEntityEvent(event, table, entity, sp),
          );
        } catch (e) {
          const mapped = tryMapUniqueViolation(e, entityName);
          if (mapped) return mapped;
          throw e;
        }
        if (result.kind !== "applied" || result.row === null) {
          return writeFailure(new InternalError({ message: "projection update returned no row" }));
        }
        const row = result.row;
        const data = await decryptForRead(rehydrateCompoundTypes(row as DbRow, entity) as DbRow);

        if (entityCache && entityName) {
          await entityCache.del(streamTenantId ?? user.tenantId, entityName, payload.id);
        }

        const echoEvent = {
          ...event,
          payload: {
            changes: stripSensitive(flatChangesPlain),
            previous: stripSensitive(previous),
          },
        };
        await projectEntityEvent(db, runner, echoEvent);

        return {
          isSuccess: true,
          data: withoutEventInJson({
            kind: "save",
            id: data["id"] as EntityId, // @cast-boundary engine-payload
            data,
            changes,
            previous,
            isNew: false,
            entityName,
            event: echoEvent,
          }),
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
              currentVersion: await versionAfterConflict(runner, String(payload.id), streamTenant),
            }),
          );
        }
        if (e instanceof EventStoreIdempotentAppendConflict) {
          return writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey }));
        }
        throw e;
      }
    },

    async delete(payload, user, db, options) {
      if (isIrreversibleEntityVerb("delete", entity)) {
        assertIrreversibleOperationAllowed(`${entityName}.delete (entity has no softDelete)`);
      }
      const runner = tenantDbWriteRunner(db, "ctx.db executor delete");
      const existing = await loadById(payload.id, db);
      if (!existing) return writeFailure(new NotFoundError(entityName, payload.id));
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
      let event: Awaited<ReturnType<typeof append>>;
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
        if (e instanceof EventStoreVersionConflict) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: currentVersion,
              currentVersion: await versionAfterConflict(
                runner,
                String(payload.id),
                streamTenantFor(user, streamTenantId),
              ),
            }),
          );
        }
        if (e instanceof EventStoreIdempotentAppendConflict) {
          return writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey }));
        }
        throw e;
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

      if (entityCache && entityName) {
        await entityCache.del(streamTenantId ?? user.tenantId, entityName, payload.id);
      }

      const echoEvent = { ...event, payload: { previous: stripSensitive(existing) } };
      await projectEntityEvent(db, runner, echoEvent);

      return {
        isSuccess: true,
        data: withoutEventInJson({
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: echoEvent,
          ...(isLockGuardBypassed(user, options) && { lockGuardBypassed: true }),
        }),
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
      const streamTenantId = options?.streamTenantId;
      const streamTenantMismatch = streamTenantOverrideFailure(db, raw, streamTenantId);
      if (streamTenantMismatch) return streamTenantMismatch;
      const existing = await decryptForRead(rehydrateCompoundTypes(raw as DbRow, entity) as DbRow);

      if (
        !isFrameworkSystemUser(user) &&
        !userCanWriteFieldRow(
          ownershipSubject(user, streamTenantId),
          entity.access?.write,
          existing,
          existing,
        )
      ) {
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

      await assertStreamWritable(db, payload.id, streamTenantFor(user, streamTenantId));
      const currentVersion = await getStreamVersion(
        runner,
        String(payload.id),
        streamTenantFor(user, streamTenantId),
      );

      let event: Awaited<ReturnType<typeof append>>;
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
                onErasedSubject: "sentinel",
              }),
            },
            metadata: buildEventMetadata(user),
          }),
        );
      } catch (e) {
        if (e instanceof EventStoreVersionConflict) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: currentVersion,
              currentVersion: await versionAfterConflict(
                runner,
                String(payload.id),
                streamTenantFor(user, streamTenantId),
              ),
            }),
          );
        }
        if (e instanceof EventStoreIdempotentAppendConflict) {
          return writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey }));
        }
        throw e;
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

      if (entityCache && entityName) {
        await entityCache.del(streamTenantId ?? user.tenantId, entityName, payload.id);
      }

      const echoEvent = { ...event, payload: { previous: stripSensitive(existing) } };
      await projectEntityEvent(db, runner, echoEvent);

      return {
        isSuccess: true,
        data: withoutEventInJson({
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: echoEvent,
          lockGuardBypassed: true,
        }),
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
      let restoreResult: Awaited<ReturnType<typeof applyEntityEvent>>;
      try {
        restoreResult = await runInSavepointIfSupported(
          withExecutorManagedWrites(runner),
          async (sp) => applyEntityEvent(event, table, entity, sp),
        );
      } catch (e) {
        const mapped = tryMapUniqueViolation(e, entityName);
        if (mapped) return mapped;
        throw e;
      }
      if (restoreResult.kind !== "applied" || restoreResult.row === null) {
        return writeFailure(new InternalError({ message: "projection restore returned no row" }));
      }
      const restored = restoreResult.row;

      if (entityCache && entityName) {
        await entityCache.del(streamTenantId ?? user.tenantId, entityName, payload.id);
      }

      // Read-side auto-convert for compound types, same as update/list.
      // decryptForRead matches create/update/list/detail: the caller-facing
      // row and `previous` snapshot must be plaintext for `encrypted` fields,
      // same as every other executor method — `data`/`restored` are raw rows
      // (db.fetchOne / applyEntityEvent), never decrypted before this point.
      const restoredHydrated = await decryptForRead(
        rehydrateCompoundTypes(restored as DbRow, entity) as DbRow,
      );

      const echoEvent = { ...event, payload: { previous: stripSensitive(previousPlain) } };
      await projectEntityEvent(db, runner, echoEvent);
      return {
        isSuccess: true,
        data: withoutEventInJson({
          kind: "save",
          id: payload.id,
          data: restoredHydrated,
          changes: { isDeleted: false },
          previous: previousPlain,
          isNew: false,
          entityName,
          event: echoEvent,
        }),
      };
    },
  };
}
