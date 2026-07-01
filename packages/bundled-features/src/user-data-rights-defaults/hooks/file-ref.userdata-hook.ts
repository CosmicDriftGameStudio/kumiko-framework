import { deleteMany, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  UserDataDeleteHook,
  UserDataExportHook,
  UserDataHookCtx,
  UserDataStorageProvider,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";

// userData-Hook fuer fileRef-entity (S2.H2).
//
// Export-Hook liefert Metadata aller FileRefs des Users mit Subject-
// Resolver via insertedById. Storage-Provider-binary-Streams kommen
// NICHT direkt — sie werden via signed-Download-URLs separat ins ZIP
// gepackt (S2.U3 Export-Job-Pipeline orchestriert das).
//
// Delete-Hook entfernt FileRef-Zeile + Binary:
//   "delete":    storageProvider.delete() pro File + Row hard-delete
//   "anonymize": insertedById=null, Row + binary bleiben (FK-Refs
//                koennen weiter zeigen; Personenbezug raus)
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

export const fileRefDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  if (strategy === "delete") {
    const storageProvider = await resolveProvider(ctx);
    if (storageProvider) {
      const rows = await selectMany(ctx.db, fileRefsTable, {
        tenantId: ctx.tenantId,
        insertedById: ctx.userId,
      });
      const failedKeys: string[] = [];
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
          failedKeys.push(key);
        }
      }
      // Fail-closed: abort before the row hard-delete so the sub-tx rolls back
      // and the next forget run retries (delete is idempotent → converges).
      if (failedKeys.length > 0) {
        throw new Error(
          `[user-data-rights-defaults:fileRef] ${failedKeys.length} binary delete(s) failed — aborting forget so the rows are retried next run (keys: ${failedKeys.join(", ")})`,
        );
      }
    } else {
      // No warn-once guard: a forget-cleanup cron runs rarely enough (not a
      // hot path) that logging every occurrence is fine, and it means an
      // operator who fixes the provider config mid-process-lifetime sees the
      // warning stop on the very next run — a module-level "warned once"
      // flag would otherwise silence this for the rest of the process even
      // after the misconfiguration is corrected.
      // biome-ignore lint/suspicious/noConsole: misconfiguration visibility — disk-leak in forget-flow
      console.warn(
        "[user-data-rights-defaults:fileRef] no file provider resolvable from ctx.buildStorageProvider — file binaries are NOT deleted on forget (row-only delete). Mount file-foundation + a file-provider-* feature and set the provider config so erasure can reach the binaries.",
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
