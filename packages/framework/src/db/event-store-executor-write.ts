import { checkWriteFieldOwnership } from "../engine/field-access";
import { userCanCreateFieldRow, userCanWriteFieldRow } from "../engine/ownership";
import type { EntityId } from "../engine/types";
import {
  VersionConflictError as FrameworkVersionConflict,
  InternalError,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "../errors";
import {
  append,
  VersionConflictError as EventStoreVersionConflict,
  getStreamVersion,
} from "../event-store";
import { generateId } from "../utils";
import { applyEntityEvent } from "./apply-entity-event";
import { flattenCompoundTypes, rehydrateCompoundTypes } from "./compound-types";
import type { DbRow } from "./connection";
import type { EventStoreExecutor } from "./event-store-executor";
import {
  buildEventMetadata,
  type ExecutorContext,
  entityEventName,
  tryMapUniqueViolation,
} from "./event-store-executor-context";
import { selectMany } from "./query";

// The five write verbs (create/update/delete/forget/restore) of the event-
// store-executor. Split out of event-store-executor.ts (#1005, Welle 2) —
// behavior-preserving relocation, not a redesign: every closure below is
// unchanged from the original, just relocated behind an explicit
// ExecutorContext instead of capturing the factory's local scope directly.

// Same value resubmitted → skip it. Avoids a phantom re-encrypt (fresh AEAD
// nonce per call) on pii/encrypted fields, and generic event-log noise on
// every other field (#464).
function isUnchangedValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
    encryptForStorage,
    decryptForRead,
    applyDefaults,
    stripSensitive,
    loadById,
    assertStreamWritable,
  } = ctx;

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
      // subjectSource carries the freshly minted aggregateId: the create
      // payload has no id column, but a pii:true self-subject resolves from it.
      const flatCreateData = flattenCompoundTypes(data, entity);
      const flatData = await encryptForStorage(flatCreateData, user, {
        subjectSource: { ...flatCreateData, id: aggregateId },
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
        event = await append(db.raw, {
          aggregateId,
          aggregateType: entityName,
          tenantId: streamTenantFor(user),
          expectedVersion: 0,
          type: entityEventName(entityName, "created"),
          payload: flatData,
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
            currentVersion = await getStreamVersion(db.raw, aggregateId, streamTenantFor(user));
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
      //    rebuildProjection für Replay nutzt, mit demselben StoredEvent →
      //    Live==Rebuild by-construction (#967).
      //
      //    F8-Patch: app-level unique-violations (z.B. (tenantId, email)
      //    auf User-Entity, (tenantId, slug) auf Article) werfen pg-23505
      //    aus der projection-INSERT. Ohne den catch propagiert das als
      //    unhandled exception → 500 internal_error. Map auf
      //    UniqueViolationError 409 damit Designer/Frontend einen sauberen
      //    "duplicate" zeigen können statt cryptic "internal server error".
      let result: Awaited<ReturnType<typeof applyEntityEvent>>;
      try {
        result = await applyEntityEvent(event, table, entity, db.raw);
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
          // Persisted event carries ciphertext by design — the caller-facing
          // echo must be plaintext like every other response field (#820).
          event: { ...event, payload: stripSensitive(flatCreateData) },
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

      await assertStreamWritable(db, payload.id, streamTenantFor(user));

      // Stream-version is authoritative, not row.version. `ctx.appendEvent`
      // can bump the stream between CRUD writes (domain event on the same
      // aggregate); a stale row.version here would make the next CRUD write
      // trip `events_aggregate_version_uq` (tenant_id, aggregate_id, version)
      // with version_conflict.
      const currentVersion = await getStreamVersion(
        db.raw,
        String(payload.id),
        streamTenantFor(user),
      );
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
        //
        // Value-diff first (#464): a resubmitted-but-unchanged key would
        // otherwise still get re-encrypted (fresh AEAD nonce → phantom
        // ciphertext diff) and land in the event as noise.
        const changedChanges = Object.fromEntries(
          Object.entries(payload.changes).filter(
            ([key, value]) => !isUnchangedValue(value, previous[key]),
          ),
        );
        const flatChangesPlain = flattenCompoundTypes(changedChanges, entity);
        const flatChanges = await encryptForStorage(flatChangesPlain, user, {
          onlyKeys: Object.keys(changedChanges),
          subjectSource: mergedNew,
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
        const event = await append(db.raw, {
          aggregateId: String(payload.id),
          aggregateType: entityName,
          tenantId: streamTenantFor(user),
          expectedVersion: currentVersion,
          type: entityEventName(entityName, "updated"),
          payload: {
            changes: flatChanges,
            previous: await encryptForStorage(previous, user),
          },
          metadata: buildEventMetadata(user),
        });

        // Live==Rebuild via applyEntityEvent mit demselben StoredEvent —
        // apply liest nur `changes`, und die sind live wie im Replay
        // identischer Ciphertext (#967).
        //
        // F8-Patch: dasselbe unique-violation-handling wie im create-Pfad
        // — ein update das einen unique-Index verletzt (z.B. email-update
        // auf einen schon-existierenden Wert) wird mit 409 unique_violation
        // statt 500 internal_error rückgemeldet.
        let result: Awaited<ReturnType<typeof applyEntityEvent>>;
        try {
          result = await applyEntityEvent(event, table, entity, db.raw);
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
            event: {
              ...event,
              payload: {
                changes: stripSensitive(flatChangesPlain),
                previous: stripSensitive(previous),
              },
            },
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

      await assertStreamWritable(db, payload.id, streamTenantFor(user));

      // Stream-version authoritative (see update() for rationale).
      const currentVersion = await getStreamVersion(
        db.raw,
        String(payload.id),
        streamTenantFor(user),
      );

      // Deletes carry the full pre-delete row as `previous`. That's what
      // projections and downstream consumers need to reverse any aggregates —
      // a `{}`-payload delete would make cross-aggregate projections impossible
      // to rebuild from the event log alone. `existing` came from loadById(),
      // which decrypts — re-encrypt before persisting so plaintext doesn't
      // land in the immutable log.
      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: streamTenantFor(user),
        expectedVersion: currentVersion,
        type: entityEventName(entityName, "deleted"),
        payload: { previous: await encryptForStorage(existing, user) },
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
        data: {
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: { ...event, payload: { previous: stripSensitive(existing) } },
        },
      };
    },

    // Hard-purge (Art. 17). Same shape as delete(), but emits `forgotten` which
    // hard-deletes the row regardless of softDelete — and, being an auto-verb,
    // the erasure replays on rebuild (created → forgotten → row gone). Loads
    // without the isDeleted filter so trashed (soft-deleted) rows are erased too.
    async forget(payload, user, db) {
      const raw = await db.fetchOne<Record<string, unknown>>(table, { id: payload.id });
      if (!raw) return writeFailure(new NotFoundError(entityName, payload.id));
      const existing = await decryptForRead(rehydrateCompoundTypes(raw as DbRow, entity) as DbRow);

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

      await assertStreamWritable(db, payload.id, streamTenantFor(user));
      const currentVersion = await getStreamVersion(
        db.raw,
        String(payload.id),
        streamTenantFor(user),
      );

      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: streamTenantFor(user),
        expectedVersion: currentVersion,
        type: entityEventName(entityName, "forgotten"),
        // Re-encrypt like delete(): `existing` came decrypted from loadById —
        // plaintext must not land in the immutable log, least of all on forget.
        payload: { previous: await encryptForStorage(existing, user) },
        metadata: buildEventMetadata(user),
      });

      const forgetResult = await applyEntityEvent(event, table, entity, db.raw);
      if (forgetResult.kind !== "applied") {
        return writeFailure(
          new InternalError({ message: "projection forget: applyEntityEvent skipped" }),
        );
      }

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: {
          kind: "delete",
          id: payload.id,
          data: existing,
          entityName,
          event: { ...event, payload: { previous: stripSensitive(existing) } },
        },
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

      await assertStreamWritable(db, payload.id, streamTenantFor(user));

      // Stream-version authoritative (see update() for rationale).
      const currentVersion = await getStreamVersion(
        db.raw,
        String(payload.id),
        streamTenantFor(user),
      );
      // Restore carries the soft-deleted snapshot as `previous` — mirror of
      // delete for symmetry. Projections that decremented on delete use
      // `previous` to re-increment on restore without re-querying the entity
      // table. `data` is the raw stored row — pii/encrypted fields are
      // already ciphertext, no re-encrypt needed.
      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: streamTenantFor(user),
        expectedVersion: currentVersion,
        type: entityEventName(entityName, "restored"),
        payload: { previous: data },
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
      // decryptForRead matches create/update/list/detail: the caller-facing
      // row and `previous` snapshot must be plaintext for `encrypted` fields,
      // same as every other executor method — `data`/`restored` are raw rows
      // (selectMany / applyEntityEvent), never decrypted before this point.
      const restoredHydrated = await decryptForRead(
        rehydrateCompoundTypes(restored as DbRow, entity) as DbRow,
      );

      const previousPlain = await decryptForRead(data);
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
          event: { ...event, payload: { previous: stripSensitive(previousPlain) } },
        },
      };
    },
  };
}
