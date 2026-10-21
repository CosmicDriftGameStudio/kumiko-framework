// applyEntityEvent — the ONLY write logic for r.entity tables from
// StoredEvents. Both callers use it:
//
//   - createEventStoreExecutor (live, in the write TX) passes the just-appended
//     StoredEvent directly; sensitive fields are table ciphertext in the payload
//     (validated at boot as pii/encrypted).
//   - rebuildProjection via ImplicitProjection (replay, in the rebuild TX)
//     passes the same StoredEvent; apply copies ciphertext byte-for-byte,
//     while bidx is recalculated below.
//
// Live==Rebuild equivalence therefore holds by construction for ALL fields —
// changed write logic needs to be maintained in only ONE place, with no sync
// contract. The only legitimate divergence is crypto-shredding
// (DEK erased → value unreadable, bidx NULL). Load-bearing test:
// db/__tests__/implicit-projection-equivalence.integration.test.ts.
//
// Tenant isolation: applyEntityEvent expects an ExecutorManagedRunner (tx or pool), NOT
// a TenantDb wrapper. Two sources keep it safe:
//   1. The live path reads the target row through the tenant-scoped TenantDb
//      before writing — loadById() for update/delete/forget, db.fetchOne() for
//      restore — so the aggregateId is already tenant-validated on arrival.
//   2. create sets tenantId explicitly from event.tenantId, never derived from
//      the TenantDb wrapper default.
// The missing TenantDb wrapper in this function is therefore not a hole.
//
// Auto-verbs:
//   <entity>.created   → INSERT
//   <entity>.updated   → UPDATE WHERE id=aggregateId
//   <entity>.deleted   → soft-delete-UPDATE if entity.softDelete, otherwise hard-DELETE
//   <entity>.restored  → undelete-UPDATE (meaningful only for softDelete)
//   <entity>.forgotten → always hard-DELETE (Art.17 purge, including softDelete);
//                        via executor.forget(). Rebuild replays created→forgotten
//                        → the row is gone, making this rebuild-safe (unlike a
//                        direct deleteMany).
//
// Domain events (r.defineEvent) on the same aggregate are NOT handled here —
// they never went through the Executor in the live path and must be handled by
// explicit r.projection-apply handlers or r.multiStreamProjection.
// ImplicitProjection registers the auto-verbs.
//
// Return shape: ApplyResult with `kind` and an optional `row`.
//   - "applied" → the write completed. `row` contains the written row for
//     create/update/soft-delete/restore. For hard-delete, `row` is null
//     (DELETE statements do not provide a returning row).
//   - "skipped" → the event is not an auto-verb (a domain event on the same
//     aggregate). Caller no-op.

import type { ExecutorManagedRunner } from "@cosmicdrift/kumiko-types/executor-brand";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { requestContext } from "../api/request-context.ts";
import { collectLookupableFields, computeBlindIndexValues } from "../crypto/blind-index.ts";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "../crypto/pii-field-encryption.ts";
import { collectPiiFileReferenceFields } from "../crypto/subject-resolver.ts";
import { deleteMany, insertOne, updateMany } from "../db/query.ts";
import type { EntityDefinition } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import type { StoredEvent } from "../event-store/index.ts";
import type { DbRow } from "./connection.ts";
import type { TableColumns } from "./dialect.ts";

type Table = TableColumns;

export type AutoVerb = "created" | "updated" | "deleted" | "restored" | "forgotten";

const AUTO_VERBS: readonly AutoVerb[] = ["created", "updated", "deleted", "restored", "forgotten"];

export type ApplyResult =
  | { readonly kind: "applied"; readonly verb: AutoVerb; readonly row: DbRow | null }
  | { readonly kind: "skipped" };

/** Parses event.type into an AutoVerb when the event is an auto-verb
 *  for the given aggregate; otherwise returns null (a domain event). */
export function parseAutoVerb(event: StoredEvent): AutoVerb | null {
  const prefix = `${event.aggregateType}.`;
  if (!event.type.startsWith(prefix)) return null;
  const verb = event.type.slice(prefix.length);
  return isOneOf(AUTO_VERBS, verb) ? verb : null;
}

// Events written by the old PII backfill can hold ciphertext in file/image uuid
// columns. Replay restores the plain fileRef id; an erased subject yields null.
async function decryptFileReferenceCiphertext(
  entity: EntityDefinition,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ciphertextFields = collectPiiFileReferenceFields(entity).filter((name) =>
    isPiiCiphertext(values[name]),
  );
  if (ciphertextFields.length === 0) return values;
  const kms = configuredPiiSubjectKms();
  if (kms === undefined) {
    throw new InternalError({
      message: `applyEntityEvent: file field(s) ${ciphertextFields.join(", ")} hold PII ciphertext but no subject KMS is configured; configure the KMS before replaying.`,
    });
  }
  const decrypted = await decryptPiiFieldValues(values, ciphertextFields, kms, {
    requestId: requestContext.get()?.requestId ?? "apply-entity-event",
  });
  for (const name of ciphertextFields) {
    if (decrypted[name] === PII_ERASED_SENTINEL) decrypted[name] = null;
  }
  return decrypted;
}

/** Applies an auto-event idempotently to the entity table.
 *  Called both during live append (inside the write TX) and during rebuild
 *  (inside the rebuild TX), using identical logic. */
export async function applyEntityEvent(
  event: StoredEvent,
  table: Table,
  entity: EntityDefinition,
  tx: ExecutorManagedRunner,
): Promise<ApplyResult> {
  const verb = parseAutoVerb(event);
  if (verb === null) return { kind: "skipped" };
  const softDelete = entity.softDelete ?? false;

  switch (verb) {
    case "created": {
      // Resolve tenantId explicitly rather than through spread order:
      // the live path uses tx=tenantDbRunner(db) (with no TenantDb wrapper
      // auto-injection), and replay has no wrapper either. The default is
      // event.tenantId; the payload wins ONLY when it is a non-empty string
      // (seedTenantMembership path: the operator writes in the target tenant,
      // while the event belongs to the operator tenant).
      //
      // Fail loudly when payload.tenantId is set but invalid (empty/null/
      // non-string): this is critical for tenant isolation. Silently falling
      // back to event.tenantId would write a bad payload into the operator
      // tenant and cause cross-tenant data drift.
      const payloadTenantId = event.payload["tenantId"];
      let tenantId: string;
      if (payloadTenantId === undefined) {
        tenantId = event.tenantId;
      } else if (typeof payloadTenantId === "string" && payloadTenantId.length > 0) {
        tenantId = payloadTenantId;
      } else {
        throw new InternalError({
          message: `applyEntityEvent: payload.tenantId set but invalid (${JSON.stringify(payloadTenantId)}). Tenant-isolation-kritisch: silent fallback auf event.tenantId würde Cross-Tenant-Drift erzeugen.`,
        });
      }
      const row = await insertOne<DbRow>(tx, table, {
        ...(await decryptFileReferenceCiphertext(entity, event.payload)),
        // Compute blind-index columns from the payload value (ciphertext → decrypt →
        // HMAC, plaintext → HMAC, erased → NULL). This is done here rather
        // than in the Executor so live writes and rebuilds produce the same
        // value and the deterministic HMAC never enters the event log.
        ...(await computeBlindIndexValues(event.payload, collectLookupableFields(entity))),
        tenantId,
        id: event.aggregateId,
        version: event.version,
        insertedAt: event.createdAt,
        insertedById: event.createdBy,
      });
      return { kind: "applied", verb, row: row ?? null };
    }

    case "updated": {
      // Payload shape: { changes, previous } — see event-store-executor.ts.
      const rawChanges = (event.payload["changes"] ?? {}) as Record<string, unknown>; // @cast-boundary engine-payload
      const changes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        await decryptFileReferenceCiphertext(entity, rawChanges),
      )) {
        const field = entity.fields[key];
        // Historical events can carry fields since removed from the entity; the
        // tolerance lives here (not in updateMany) so a live typo still throws.
        // Base/soft-delete columns (insertedById, deletedAt, ...) are table
        // columns without an entity field and must still be applied.
        if (field === undefined && !(key in table)) continue;
        changes[key] = value;
      }
      const rows = await updateMany<DbRow>(
        tx,
        table,
        {
          ...changes,
          // Recompute bidx only for the lookupable fields that changed (see created).
          ...(await computeBlindIndexValues(changes, collectLookupableFields(entity))),
          version: event.version,
          modifiedAt: event.createdAt,
          modifiedById: event.createdBy,
        },
        { id: event.aggregateId },
      );
      return { kind: "applied", verb, row: rows[0] ?? null };
    }

    case "deleted": {
      if (softDelete) {
        const rows = await updateMany<DbRow>(
          tx,
          table,
          {
            isDeleted: true,
            deletedAt: event.createdAt,
            deletedById: event.createdBy,
            version: event.version,
            modifiedAt: event.createdAt,
            modifiedById: event.createdBy,
          },
          { id: event.aggregateId },
        );
        return { kind: "applied", verb, row: rows[0] ?? null };
      }
      // Hard-delete: the DELETE statement provides no returning row, and
      // the live path already uses `existing` (the pre-delete snapshot) for
      // the response. During replay, the caller does not need the row.
      await deleteMany(tx, table, { id: event.aggregateId });
      return { kind: "applied", verb, row: null };
    }

    case "restored": {
      // Restore is meaningful only for softDelete. Hard-delete entities should
      // not receive restored events; if they do, defensively skip them.
      if (!softDelete) return { kind: "skipped" };
      const rows = await updateMany<DbRow>(
        tx,
        table,
        {
          isDeleted: false,
          deletedAt: null,
          deletedById: null,
          version: event.version,
          modifiedAt: event.createdAt,
          modifiedById: event.createdBy,
        },
        { id: event.aggregateId },
      );
      return { kind: "applied", verb, row: rows[0] ?? null };
    }

    case "forgotten": {
      // Hard-delete regardless of softDelete: forget/purge (Art. 17) removes the
      // row entirely. On rebuild the aggregate replays created → forgotten, so
      // the row ends up gone — the rebuild-safe erasure the soft-delete verb
      // (which only flips isDeleted) cannot provide.
      await deleteMany(tx, table, { id: event.aggregateId });
      return { kind: "applied", verb, row: null };
    }
  }
}
