import { deleteMany, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { type FileStorageProvider, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";

// userData-Hook fuer fileRef-entity (S2.H2).
//
// Export-Hook liefert Metadata aller FileRefs des Users mit Subject-
// Resolver via insertedById. Storage-Provider-binary-Streams kommen
// NICHT direkt — sie werden via signed-Download-URLs separat ins ZIP
// gepackt (S2.U3 Export-Job-Pipeline orchestriert das).
//
// Delete-Hook entfernt FileRef-Zeile via factory
// `createFileRefDeleteHook(storageProvider)`:
//   "delete":    storageProvider.delete() pro File (best-effort) + Row hard-delete
//   "anonymize": insertedById=null, Row + binary bleiben (FK-Refs
//                koennen weiter zeigen; Personenbezug raus)
//
// Storage-Provider-Cleanup ist BEST-EFFORT — wenn S3-delete failt,
// log + skip (Cron-Job kann es retry). Memory: Forget-Atomicity-
// Decision aus Sprint-2-Architektur (advisor-pinned): per-Hook
// idempotent, KEIN globaler Rollback — wenn ein File-Delete failt,
// bleibt der User-Row trotzdem anonymisiert.
//
// `storageProvider` ist optional. App-Author wired es beim
// Feature-Mount rein (`createUserDataRightsDefaultsFeature({
// storageProvider })`). Ohne Provider macht der Hook row-only-delete,
// die Bytes leaken — der Caller bekommt EINEN Warn beim ersten Lauf
// pro Process, damit die Konfiguration sichtbar fehlerhaft ist.
//
// Caveat: hard-delete via deleteMany emittiert KEIN fileRef.deleted —
// die storage-tracking-MSP dekrementiert nicht. Wenn die zu loeschenden
// Files vorher nicht soft-deleted waren, bleibt `tenant_storage_usage`
// inflated. Forget-Flows sind selten (per-User-Art.-17) und damit
// bounded; ein executor.purge-API folgt mit dem trashed-files-GC.

export const fileRefExportHook: UserDataExportHook = async (ctx) => {
  // isDeleted:false — soft-deleted (trashed) Files gehören nicht ins
  // Auskunfts-Bundle. Forget (delete-Hook unten) erfasst sie trotzdem.
  const rawRows = await selectMany(ctx.db, fileRefsTable, {
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

let missingStorageWarned = false;

export function createFileRefDeleteHook(
  storageProvider: FileStorageProvider | undefined,
): UserDataDeleteHook {
  return async (ctx, strategy) => {
    if (strategy === "delete") {
      if (storageProvider) {
        const rows = await selectMany(ctx.db, fileRefsTable, {
          tenantId: ctx.tenantId,
          insertedById: ctx.userId,
        });
        for (const row of rows) {
          const key = (row as Record<string, unknown>)["storageKey"]; // @cast-boundary db-row
          if (typeof key !== "string" || key.length === 0) continue;
          try {
            await storageProvider.delete(key);
          } catch (err) {
            // biome-ignore lint/suspicious/noConsole: operator-visibility for binary-cleanup-failure
            console.warn(
              `[user-data-rights-defaults:fileRef] storage delete failed key=${key} err=${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } else if (!missingStorageWarned) {
        missingStorageWarned = true;
        // biome-ignore lint/suspicious/noConsole: misconfiguration visibility — disk-leak in forget-flow
        console.warn(
          "[user-data-rights-defaults:fileRef] no storageProvider configured — file binaries are NOT deleted on forget. Pass createUserDataRightsDefaultsFeature({ storageProvider }) to fix.",
        );
      }
      await deleteMany(ctx.db, fileRefsTable, { tenantId: ctx.tenantId, insertedById: ctx.userId });
    } else {
      // anonymize: insertedById=null, FileRef + binary bleiben.
      // Use-case: shared chat-Attachment in einem Multi-User-Channel —
      // Author-Identifikation raus, Datei bleibt fuer andere User
      // sichtbar.
      await updateMany(
        ctx.db,
        fileRefsTable,
        { insertedById: null },
        { tenantId: ctx.tenantId, insertedById: ctx.userId },
      );
    }
  };
}

// Legacy export: storage-less hook for callers that haven't migrated.
// Binaries are NOT cleaned up — disk leak. Migrate to
// createUserDataRightsDefaultsFeature({ storageProvider }).
export const fileRefDeleteHook: UserDataDeleteHook = createFileRefDeleteHook(undefined);
