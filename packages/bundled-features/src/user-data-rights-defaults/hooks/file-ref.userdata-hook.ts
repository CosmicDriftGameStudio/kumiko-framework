import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { derivativeListPrefix, isDerivativeKeyOf } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  createSystemUser,
  type FieldDefinition,
  type Registry,
  type SessionUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
  type UserDataHookCtx,
  type UserDataStorageProvider,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  assertSafeStorageKey,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { assertErased } from "../../shared";

// Forget writes go through the executor (events), not deleteMany/updateMany:
// a projection rebuild replays the events, so the erasure survives. Eventless
// writes are wiped/resurrected on rebuild — the Art.17 hole this fixes. Bounded:
// per-user forget flows are rare, so per-row events are acceptable.
const crud = createEventStoreExecutor(fileRefsTable, fileRefEntity, { entityName: "fileRef" });

// userData-Hook fuer fileRef-entity (S2.H2).
//
// Export-Hook liefert Metadata aller FileRefs des Users mit Subject-
// Resolver via insertedById. Storage-Provider-binary-Streams kommen
// NICHT direkt — sie werden via signed-Download-URLs separat ins ZIP
// gepackt (S2.U3 Export-Job-Pipeline orchestriert das).
//
// Delete-hook removes the fileRef row + binary:
//   "delete":    storageProvider.delete() per file + row hard-delete — but
//                ONLY for rows whose field is marked as PII of the person
//                (isPersonalFileRow, #3005). All other rows (business/
//                tenant data, no resolvable field, no annotation) go
//                through severPersonLink instead, even when the entity
//                strategy is "delete" — the uploader axis (insertedById) is
//                not the subject axis.
//   "anonymize": insertedById=null, row + binary survive (FK refs can still
//                point at it; person-link removed) — applies to ALL rows
//                when the entity strategy itself is already anonymize (e.g.
//                blockDelete retention), regardless of the field.
//
// **Provider-Resolution:** der Provider kommt zur Lauf-Zeit aus
// `ctx.buildStorageProvider(ctx.tenantId)` — der Forget-Orchestrator
// (run-forget-cleanup) baut ihn aus dem gemounteten file-foundation, also aus
// DEMSELBEN Store den Upload + Export nutzen (delete-target == upload-target by
// construction). Kein bei-Mount captured Provider mehr.
//
// **Zwei Fehlerklassen, bewusst verschieden behandelt:**
//   1. Resolution schlaegt fehl (kein Provider konfiguriert / configResolver
//      fehlt) → NICHT fail-closed: Warn pro Aufruf + row-only-delete. Ein
//      fehlkonfigurierter Store darf die Art.-17-Loeschung nicht DAUERHAFT
//      blockieren (sonst haengt jeder User fuer immer in DeletionRequested);
//      der Boot-Guard macht die Fehlkonfiguration sichtbar, Binaries werden
//      nachgeholt sobald ein Provider existiert.
//   2. Binary-DELETE schlaegt fehl, OBWOHL ein Provider da ist → FAIL-CLOSED:
//      der Hook wirft NACH dem Loop, die per-User-Sub-Tx von runForgetCleanup
//      rollt zurueck, der User bleibt DeletionRequested, der naechste Run
//      retried (delete ist idempotent → konvergiert). Den Fehler zu schlucken +
//      die Row trotzdem zu loeschen wuerde Erasure als "done" markieren waehrend
//      die Bytes liegen bleiben — falsche Compliance-Aussage. Das "KEIN globaler
//      Rollback" der Sprint-2-Atomicity bleibt gewahrt: nur DIESE Sub-Tx rollt
//      zurueck. Der anonymize-Pfad behaelt Row+binary, hat nichts zu schlucken.
//
// Caveat: hard-delete via deleteMany emittiert KEIN fileRef.deleted —
// die storage-tracking-MSP dekrementiert nicht. Wenn die zu loeschenden
// Files vorher nicht soft-deleted waren, bleibt `tenant_storage_usage`
// inflated. Forget-Flows sind selten (per-User-Art.-17) und damit
// bounded; ein executor.purge-API folgt mit dem trashed-files-GC.

export const fileRefExportHook: UserDataExportHook = async (ctx) => {
  // isDeleted:false — soft-deleted (trashed) Files gehören nicht ins
  // Auskunfts-Bundle. Forget (delete-Hook unten) erfasst sie trotzdem.
  const rawRows = await ctx.db.selectMany(fileRefsTable, {
    tenantId: ctx.tenantId,
    insertedById: ctx.userId,
    isDeleted: false,
  });

  // @cast-boundary db-row: drizzle liefert insertedAt als Instant
  // (framework-customType). Fuer JSON-Export brauchen wir String —
  // .toString() funktioniert sowohl auf Temporal.Instant als auch
  // Date.
  const rows = rawRows.map((r) => {
    const row = r as Record<string, unknown>; // @cast-boundary recursive-walk
    return {
      id: String(row["id"]),
      storageKey: String(row["storageKey"]),
      fileName: String(row["fileName"]),
      mimeType: String(row["mimeType"]),
      size: typeof row["size"] === "number" ? row["size"] : 0,
      insertedAt: String(row["insertedAt"] ?? ""),
    };
  });

  if (rows.length === 0) return null;

  return {
    entity: "fileRef",
    rows: rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      size: r.size,
      insertedAt: r.insertedAt,
    })),
    // Plus die fileRefs-Liste die Sprint-2-U3 dann zum Storage-Provider
    // bringt + signed-URLs erzeugt + ins ZIP packt (siehe S1.9-Z1
    // UserDataExportSnippet.fileRefs).
    fileRefs: rows.map((r) => ({
      fileRefId: r.id,
      storageKey: r.storageKey,
      fileName: r.fileName,
    })),
  };
};

// Resolve the per-tenant provider the forget orchestrator injected. A
// resolution failure (no provider configured / configResolver absent) collapses
// to `undefined` so the hook degrades to a row-only delete instead of throwing —
// see error-class 1 in the header. A working-provider binary-delete failure is
// handled separately (fail-closed) below.
async function resolveProvider(ctx: UserDataHookCtx): Promise<UserDataStorageProvider | undefined> {
  if (!ctx.buildStorageProvider) return undefined;
  try {
    return await ctx.buildStorageProvider(ctx.tenantId);
  } catch {
    // skip: provider unresolvable (not configured) → fall through to row-only
    // delete; the warn below gives operator visibility, boot guard catches it.
    return undefined;
  }
}

// Per-row Art.17 decision (kumiko-framework#3005): whether THIS file's field
// carries personal data of the forgotten person, or is business/tenant data
// that merely loses its uploader-attribution. insertedById names who
// UPLOADED the file, not whose data it is — a dealer's vehicle photo
// uploaded by an employee is the dealer's business data, not the employee's
// PII. The field's own personal-annotation decides:
//   - pii / userOwned / recordOwned → the field's content IS personal data
//     of a person (self, owner-referenced, or the record's own subject) →
//     hard-delete path.
//   - anything else (explicit `personal: false`, `tenantOwned`,
//     `subjectRef`, or no annotation at all) → not personal-to-a-person
//     content → sever the uploader link only, keep row + binary.
function isPersonalPiiField(field: FieldDefinition | undefined): boolean {
  if (!field) return false;
  return (
    ("pii" in field && field.pii === true) ||
    ("userOwned" in field && field.userOwned !== undefined) ||
    ("recordOwned" in field && field.recordOwned === true)
  );
}

// Three cases the field-lookup itself can't resolve (issue #3005's rule for
// the non-resolvable cases):
//   1. Unattached upload (entityType/fieldName both null) → hard-delete: a
//      file with no entity binding belongs to nobody but its uploader.
//   2. Field exists but carries no PII annotation → anonymize (the
//      conservative path); the boot-validator warns on a PII-typical field
//      name so this stays visible and quiet-fixable via `personal`.
//   3. Entity or field not resolvable (upload hardening in file-routes.ts
//      should prevent this from ever being written; theoretical remainder
//      only) → anonymize, never a silent hard-delete.
function isPersonalFileRow(registry: Registry, row: Record<string, unknown>): boolean {
  const entityType = row["entityType"]; // @cast-boundary db-row
  const fieldName = row["fieldName"]; // @cast-boundary db-row
  if (entityType === null && fieldName === null) return true;
  if (typeof entityType !== "string" || typeof fieldName !== "string") return false;
  const fieldDef = registry.getEntity(entityType)?.fields[fieldName];
  return isPersonalPiiField(fieldDef);
}

// Derivatives (thumbnails/resized variants — see derivatives-context.ts) are
// never tracked anywhere but the storage layer: they're rendered under a
// deterministic key (deriveKey + variantSuffix) computed from the original's
// key + a render spec, on demand, and nothing writes that key back onto the
// FileRef row. List the original's key-prefix and keep only candidates whose
// suffix matches the derivative grammar, anchored to the original's own
// basename AND extension — a same-directory sibling original (a different
// file, possibly another user's) shares the same list prefix but fails the
// extension/suffix check and is never touched.
async function listDerivativeKeys(
  originalKey: string,
  provider: UserDataStorageProvider,
): Promise<readonly string[]> {
  let candidates: readonly string[];
  try {
    candidates = await provider.list(derivativeListPrefix(originalKey));
  } catch (err) {
    // Wrap rather than let a raw provider error (e.g. S3 AccessDenied) surface
    // unexplained — list() is a NEW requirement this hook added on top of
    // delete(); a bucket policy granting only s3:DeleteObject now fails forget
    // every run instead of just leaving derivatives behind. Name the likely
    // cause so an operator doesn't have to guess.
    throw new Error(
      `[user-data-rights-defaults:fileRef] provider.list() failed while looking up derivatives of key=${originalKey} — forget/erasure requires list permission on the storage bucket (e.g. s3:ListBucket), not just delete. Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const derivativeKeys: string[] = [];
  for (const candidate of candidates) {
    if (!isDerivativeKeyOf(originalKey, candidate)) continue;
    try {
      assertSafeStorageKey(candidate);
    } catch {
      // ponytail: a listing hit that fails the storage-key grammar can't be
      // a real derivative (every derivative is written via a validated
      // write()) — skip rather than pass a malformed key to delete().
      continue;
    }
    derivativeKeys.push(candidate);
  }
  return derivativeKeys;
}

// Delete every row's binary (original + any derivatives) via the provider.
// Returns the keys whose delete threw — the caller fails closed on a
// non-empty list so the sub-tx rolls back and the next forget run retries
// (delete is idempotent → converges).
async function deleteBinaries(
  rows: readonly Record<string, unknown>[],
  provider: UserDataStorageProvider,
): Promise<readonly string[]> {
  const failedKeys: string[] = [];
  for (const row of rows) {
    const key = row["storageKey"]; // @cast-boundary db-row
    if (typeof key !== "string" || key.length === 0) continue;
    const keysToDelete = [key, ...(await listDerivativeKeys(key, provider))];
    for (const k of keysToDelete) {
      try {
        await provider.delete(k);
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: operator-visibility for binary-cleanup-failure
        console.warn(
          `[user-data-rights-defaults:fileRef] storage delete failed key=${k} err=${err instanceof Error ? err.message : String(err)}`,
        );
        failedKeys.push(k);
      }
    }
  }
  return failedKeys;
}

// Null the person-link on every row via the executor (event → rebuild-safe).
// tdb: the executor needs a TenantDb (loadById → db.fetchOne), not the raw
// ctx.db runner.
async function severPersonLink(
  tdb: TenantDb,
  systemUser: SessionUser,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  for (const row of rows) {
    const id = row["id"]; // @cast-boundary db-row
    if (typeof id !== "string") continue;
    await crud.update({ id, changes: { insertedById: null } }, systemUser, tdb, {
      skipOptimisticLock: true,
    });
  }
}

export const fileRefDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  const systemUser = createSystemUser(ctx.tenantId);
  const rows = await ctx.db.selectMany<Record<string, unknown>>(fileRefsTable, {
    tenantId: ctx.tenantId,
    insertedById: ctx.userId,
  });

  if (strategy !== "delete") {
    // anonymize: insertedById=null, FileRef + binary bleiben. Use-case: shared
    // chat-Attachment im Multi-User-Channel — Author-ID raus, Datei bleibt sichtbar.
    // Applies to ALL rows — the entity strategy comes from a retention
    // policy (e.g. blockDelete) and overrides the per-field decision below,
    // which only applies for strategy="delete".
    await severPersonLink(ctx.db, systemUser, rows);
    // skip: anonymize is complete — the hard-delete path below runs only for strategy "delete".
    return;
  }

  // strategy="delete" decides PER ROW based on the field, not uniformly
  // (#3005): only rows whose field is marked as PII of the person (or
  // unattached, see isPersonalFileRow) take the hard path. Everything else
  // only loses the uploader link.
  const personalRows: Record<string, unknown>[] = [];
  const businessRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    (isPersonalFileRow(ctx.registry, row) ? personalRows : businessRows).push(row);
  }

  if (businessRows.length > 0) {
    await severPersonLink(ctx.db, systemUser, businessRows);
  }

  // skip: nothing left to hard-delete — businessRows above already had their person link severed via severPersonLink.
  if (personalRows.length === 0) return;

  const storageProvider = await resolveProvider(ctx);
  if (storageProvider) {
    const failedKeys = await deleteBinaries(personalRows, storageProvider);
    if (failedKeys.length > 0) {
      throw new Error(
        `[user-data-rights-defaults:fileRef] ${failedKeys.length} binary delete(s) failed — aborting forget so the rows are retried next run (keys: ${failedKeys.join(", ")})`,
      );
    }
  } else {
    // No warn-once guard: a forget-cleanup cron runs rarely enough (not a hot
    // path) that logging every occurrence is fine, and an operator who fixes the
    // provider config mid-process sees the warning stop on the very next run —
    // a module-level "warned once" flag would silence it for the rest of the
    // process even after the misconfiguration is corrected.
    // biome-ignore lint/suspicious/noConsole: misconfiguration visibility — disk-leak in forget-flow
    console.warn(
      "[user-data-rights-defaults:fileRef] no file provider resolvable from ctx.buildStorageProvider — file binaries are NOT deleted on forget (row-only delete). Mount file-foundation + a file-provider-* feature and set the provider config so erasure can reach the binaries.",
    );
  }
  // Hard-purge each row via the executor forget-verb: emits fileRef.forgotten,
  // which hard-deletes the row even though fileRef is softDelete — and, being an
  // auto-verb, the erasure replays on rebuild (created → forgotten → row gone).
  // The old hard deleteMany was resurrected on rebuild; this closes that Art.17
  // hole without a direct write.
  for (const row of personalRows) {
    const id = row["id"]; // @cast-boundary db-row
    if (typeof id !== "string") continue;
    assertErased(await crud.forget({ id }, systemUser, ctx.db), "fileRef", id);
  }
};
