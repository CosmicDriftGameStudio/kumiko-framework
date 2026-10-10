import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { ZodType } from "zod";
import { checkWriteFieldOwnership } from "../engine/field-access.js";
import { instructionFieldNames } from "../engine/instruction-fields.js";
import { userCanCreateFieldRow, userCanWriteFieldRow } from "../engine/ownership.js";
import { buildInsertSchema, buildUpdateSchema } from "../engine/schema-builder.js";
import {
  findUnavailableSelectOptions,
  type UnavailableSelectOption,
} from "../engine/screen-helpers.js";
import { SYSTEM_ROLE, SYSTEM_USER_ID } from "../engine/system-user.js";
import type { EntityId, SessionUser, TenantId } from "../engine/types/index.js";
import {
  AccessDeniedError,
  VersionConflictError as FrameworkVersionConflict,
  IdempotentReplayError,
  InternalError,
  NotFoundError,
  PreconditionFailedError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "../errors/index.js";
import {
  append,
  IdempotentAppendConflictError as EventStoreIdempotentAppendConflict,
  VersionConflictError as EventStoreVersionConflict,
  getStreamVersion,
  type StoredEvent,
} from "../event-store/index.js";
import {
  assertInstructionFieldWriteAllowed,
  assertIrreversibleOperationAllowed,
  isIrreversibleEntityVerb,
} from "../pipeline/irreversible-operation-gate.js";
import {
  hasLiveProjectionsForEvent,
  runProjectionsForEvent,
} from "../pipeline/projections-runner.js";
import { generateId } from "../utils/index.js";
import { applyEntityEvent } from "./apply-entity-event.js";
import { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types.js";
import type { DbRow, DbRunner } from "./connection.js";
import type { EventStoreExecutor } from "./event-store-executor.js";
import {
  buildEventMetadata,
  type ExecutorContext,
  entityEventName,
  isForeignTenantOnGlobalEntity,
  ownershipSubject,
  tryMapUniqueViolation,
} from "./event-store-executor-context.js";
import { projectionRegistryOf } from "./projection-registry-binding.js";
import { runInSavepointIfSupported } from "./query.js";
import { assertPersonalDataWrite, tableNameOf } from "./tenant-db.js";
import { tenantDbRunner } from "./tenant-db-runner.js";

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

// Art. 17 erasure runs as the framework operator, not as a row owner; a
// per-role ownership map can never cover it, and a silent deny means the
// erasure never happened.
function isFrameworkSystemUser(user: SessionUser): boolean {
  return user.id === SYSTEM_USER_ID && user.roles.includes(SYSTEM_ROLE);
}

// The five write verbs (create/update/delete/forget/restore) of the event-
// store-executor. Split out of event-store-executor.ts (#1005, Welle 2) —
// behavior-preserving relocation, not a redesign: every closure below is
// unchanged from the original, just relocated behind an explicit
// ExecutorContext instead of capturing the factory's local scope directly.

// updateOptions.skipUnchanged (#464) — opt-in: a resubmitted-but-identical
// key is dropped before encryption so pii/encrypted fields don't get a fresh
// AEAD ciphertext (new nonce) for no real change, and the event's `changes`
// don't carry a phantom diff. Opt-in, not the executor's default, because
// direct executor.update() callers rely on the current behavior to FORCE a
// re-encrypt of an unchanged plaintext — KEK-rotation (auth-mfa reencrypt.job)
// and the user-data-rights #494 backfill both resubmit the current value on
// purpose to land a fresh event/ciphertext. Only the generic entity update
// handler (entity-handlers.ts) sets this flag; those two call their own
// executor directly and never see it.
function isUnchangedValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
// as it will actually be persisted, including hook-derived fields
// (kumiko-framework#1672). A throwing hook is an app-author bug (bad
// business rule, not a framework fault) — map it to a clean writeFailure
// instead of letting it propagate as an internal_error 500.
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
    // from generateId()/the loaded row, not from hook output (fw#1685).
    const { id: _hookId, version: _hookVersion, ...safe } = hookResult as Record<string, unknown>;
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
    applyDefaults,
    stripSensitive,
    loadById,
    assertStreamWritable,
    loadExpectSnapshot,
  } = ctx;
  const entityInstructionFieldNames = instructionFieldNames(entity);
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
      const runner = tenantDbRunner(db);
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
      // Which fields get checked is scoped to the pre-hook payload (fw#1685)
      // — a hook-derived field the user never submitted must not be
      // field-ownership-checked against the user. The rule for a checked
      // field is still evaluated against the full post-hook row (`data`) —
      // an ownership rule can reference a column only a hook populates
      // (kumiko-framework#1672).
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

      // Alle Compound-Types (locatedTimestamp, money, ...) gehen durch
      // dieselbe Pipeline. Caller schickt combined API-Form, Framework
      // speichert flat DB-Form. Siehe db/compound-types.ts.
      // subjectSource carries the freshly minted aggregateId: the create
      // payload has no id column, but a pii:true self-subject resolves from it.
      const flatCreateData = flattenCompoundTypes(data, entity);
      const flatData = await encryptForStorage(flatCreateData, user, {
        subjectSource: { ...flatCreateData, id: aggregateId },
        keyTenantId: streamTenantId,
      });

      // 1. Append event (same TX as the projection write — both must succeed
      //    or both roll back; the dispatcher wraps both in one transaction).
      //    flatData is already table ciphertext for pii/encrypted fields, so
      //    the immutable log never sees plaintext and replay reproduces the
      //    row byte-identically (#967).
      //
      //    `expectedVersion: 0` heißt: stream existiert noch nicht. Bei
      //    deterministic-aggregate-id-Patterns (z.B. uuidv5(tenantId|naturalKey))
      //    ist es legitim dass create kollidiert — selbe id, schon vorhandener
      //    stream → version_conflict statt internal_error. Update hat den
      //    selben catch (siehe line 493+).
      let event: Awaited<ReturnType<typeof append>>;
      try {
        // Savepoint-scoped: postgres.js/Bun.SQL poison the WHOLE surrounding
        // begin() once any statement inside it errors, even if the JS error
        // is caught (kumiko-framework#1778) — a losing concurrent create's
        // unique-violation would otherwise abort the caller's outer
        // transaction and surface as internal_error at commit time instead
        // of the version_conflict this catch classifies. runInSavepointIfSupported
        // confines the failed INSERT to a nested scope that rolls back on
        // its own (same pattern as ctx.tryAppendEvent), and falls back to a
        // plain call when the runner is a bare pool connection with no active
        // transaction to poison (seeds/tests calling the executor directly).
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
          let currentVersion = -1;
          try {
            currentVersion = await getStreamVersion(
              runner,
              aggregateId,
              streamTenantFor(user, streamTenantId),
            );
          } catch {
            // Lookup failure — keep the sentinel.
          }
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

      // 2. Update projection via applyEntityEvent — derselbe Code-Pfad den
      //    rebuildProjection für Replay nutzt, mit demselben StoredEvent →
      //    Live==Rebuild by-construction (#967).
      //
      //    F8-Patch: app-level unique-violations (z.B. (tenantId, email)
      //    auf User-Entity, (tenantId, slug) auf Article) werfen pg-23505
      //    aus der projection-INSERT. Ohne den catch propagiert das als
      //    unhandled exception → 500 internal_error. Map auf
      //    UniqueViolationError 409 damit Designer/Frontend einen sauberen
      //    "duplicate" zeigen können statt cryptic "internal server error".
      // Savepoint like the append above: an unclassified DB error out of the
      // projection INSERT would otherwise poison the enclosing tx (Bun.SQL
      // rejects the whole begin() once any statement in it failed), so a later
      // write sharing that tx — a sibling write after a failed nested one —
      // throws raw as a 500 instead of failing cleanly. The savepoint rolls the
      // failed INSERT back; the error still propagates and stays catchable.
      let result: Awaited<ReturnType<typeof applyEntityEvent>>;
      try {
        result = await runInSavepointIfSupported(runner, async (sp) =>
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
      // Read-Side Auto-Convert: DB-Form → API-combined-Form für alle
      // Compound-Types in einem Pass.
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
        data: {
          kind: "save",
          id: aggregateId,
          data: projection,
          changes: data,
          previous: {},
          isNew: true,
          entityName,
          // Persisted event carries ciphertext by design — the caller-facing
          // echo must be plaintext like every other response field (#820).
          event: echoEvent,
        },
      };
    },

    async update(payload, user, db, updateOptions) {
      const runner = tenantDbRunner(db);
      if (isForeignTenantOnGlobalEntity(entity, payload.changes["tenantId"])) {
        throw new AccessDeniedError({
          message:
            `${entityName}.update: entity is tenancy: "global" — payload.changes.tenantId must ` +
            "be SYSTEM_TENANT_ID or omitted.",
        });
      }
      const previous = await loadById(payload.id, db);
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
      // actual submission), NOT `changes` (post-preSave-hook data, fw#1685)
      // — a hook-derived field the user never submitted (e.g. a system hook
      // setting `assignedTo`) has no business being field-ownership-checked
      // against the *user*, and doing so rejects writes the user is fully
      // entitled to make. The dispatcher's role-gate (checkWriteFieldAccess)
      // already runs on this same pre-hook payload for consistency. The rule
      // for a checked field is still evaluated against the full post-hook
      // row (`changes` merged onto `previous`) — an ownership rule can
      // reference a column only a hook populates (kumiko-framework#1672).
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

      const unavailableOnUpdate = selectOptionNotAvailableFailure(
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
        // Compound-Types Auto-Convert (alle in einem Pass).
        // subjectSource: partial changes may carry a pii field without its
        // ownerField — the merged row still names the subject.
        const submittedChanges = updateOptions?.skipUnchanged
          ? Object.fromEntries(
              Object.entries(changes).filter(
                ([key, value]) => !isUnchangedValue(value, previous[key]),
              ),
            )
          : changes;
        const flatChangesPlain = flattenCompoundTypes(submittedChanges, entity);
        const flatChanges = await encryptForStorage(flatChangesPlain, user, {
          onlyKeys: Object.keys(submittedChanges),
          subjectSource: mergedNew,
          keyTenantId: streamTenantId,
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
        const encryptedPrevious = await encryptForStorage(previous, user, {
          keyTenantId: streamTenantId,
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

        // Live==Rebuild via applyEntityEvent mit demselben StoredEvent —
        // apply liest nur `changes`, und die sind live wie im Replay
        // identischer Ciphertext (#967).
        //
        // F8-Patch: dasselbe unique-violation-handling wie im create-Pfad
        // — ein update das einen unique-Index verletzt (z.B. email-update
        // auf einen schon-existierenden Wert) wird mit 409 unique_violation
        // statt 500 internal_error rückgemeldet.
        // Savepoint like the create path: a raw DB error out of the projection
        // UPDATE poisons the enclosing tx otherwise, so a sibling write after a
        // failed nested one throws 500 instead of failing cleanly.
        let result: Awaited<ReturnType<typeof applyEntityEvent>>;
        try {
          result = await runInSavepointIfSupported(runner, async (sp) =>
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
        if (e instanceof EventStoreVersionConflict) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: payload.version ?? 0,
              currentVersion,
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
      const runner = tenantDbRunner(db);
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
              previous: await encryptForStorage(existing, user, { keyTenantId: streamTenantId }),
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
              currentVersion: -1,
            }),
          );
        }
        if (e instanceof EventStoreIdempotentAppendConflict) {
          return writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey }));
        }
        throw e;
      }

      // Live==Rebuild via applyEntityEvent. Savepoint like create/update.
      const deleteResult = await runInSavepointIfSupported(runner, async (sp) =>
        applyEntityEvent(event, table, entity, sp),
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
        data: {
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: echoEvent,
        },
      };
    },

    // Hard-purge (Art. 17). Same shape as delete(), but emits `forgotten` which
    // hard-deletes the row regardless of softDelete — and, being an auto-verb,
    // the erasure replays on rebuild (created → forgotten → row gone). Loads
    // without the isDeleted filter so trashed (soft-deleted) rows are erased too.
    async forget(payload, user, db, options) {
      assertIrreversibleOperationAllowed(`${entityName}.forget`);
      const runner = tenantDbRunner(db);
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
              previous: await encryptForStorage(existing, user, { keyTenantId: streamTenantId }),
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
              currentVersion: -1,
            }),
          );
        }
        if (e instanceof EventStoreIdempotentAppendConflict) {
          return writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey }));
        }
        throw e;
      }

      const forgetResult = await runInSavepointIfSupported(runner, async (sp) =>
        applyEntityEvent(event, table, entity, sp),
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
        data: {
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: echoEvent,
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
      const runner = tenantDbRunner(db);
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
      // table. `data` is the raw stored row — pii/encrypted fields are
      // already ciphertext, no re-encrypt needed.
      let event: Awaited<ReturnType<typeof append>>;
      try {
        event = await runInSavepointIfSupported(runner, (sp) =>
          append(sp, {
            aggregateId: String(payload.id),
            aggregateType: entityName,
            tenantId: streamTenantFor(user, streamTenantId),
            expectedVersion: currentVersion,
            type: entityEventName(entityName, "restored"),
            eventVersion,
            payload: { previous: data },
            metadata: buildEventMetadata(user),
          }),
        );
      } catch (e) {
        if (e instanceof EventStoreVersionConflict) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: currentVersion,
              currentVersion: -1,
            }),
          );
        }
        if (e instanceof EventStoreIdempotentAppendConflict) {
          return writeFailure(new IdempotentReplayError({ idempotencyKey: e.idempotencyKey }));
        }
        throw e;
      }

      // Live==Rebuild via applyEntityEvent. Restore only writes isDeleted=false
      // plus the version bump, so there is no sensitive-field drift and no
      // payload override is needed.
      // Soft-delete unique indexes are partial (WHERE is_deleted = false), so a live row may have re-taken the value this restore brings back.
      let restoreResult: Awaited<ReturnType<typeof applyEntityEvent>>;
      try {
        restoreResult = await runInSavepointIfSupported(runner, async (sp) =>
          applyEntityEvent(event, table, entity, sp),
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

      const previousPlain = await decryptForRead(data);
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
