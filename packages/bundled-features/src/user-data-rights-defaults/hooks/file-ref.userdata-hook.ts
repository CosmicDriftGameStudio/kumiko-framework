import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { selectMany, deleteMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";

// userData-Hook fuer fileRef-entity (S2.H2).
//
// Export-Hook liefert Metadata aller FileRefs des Users mit Subject-
// Resolver via insertedById. Storage-Provider-binary-Streams kommen
// NICHT direkt — sie werden via signed-Download-URLs separat ins ZIP
// gepackt (S2.U3 Export-Job-Pipeline orchestriert das).
//
// Delete-Hook entfernt FileRef-Zeile + Storage-Binary. Plan-Roadmap
// docs/plans/datenschutz/storage-encryption.md hat das Subject-
// Resolver-Pattern fuer File-Encryption als Sprint 4 — bis dahin:
//   "delete":    Row hard-delete + storageProvider.delete() pro File
//   "anonymize": insertedById=null, Row + binary bleiben (FK-Refs
//                koennen weiter zeigen; Personenbezug raus)
//
// Storage-Provider-Cleanup ist BEST-EFFORT — wenn S3-delete failt,
// log + skip (Cron-Job kann es retry). Memory: Forget-Atomicity-
// Decision aus Sprint-2-Architektur (advisor-pinned): per-Hook
// idempotent, KEIN globaler Rollback — wenn ein File-Delete failt,
// bleibt der User-Row trotzdem anonymisiert.
//
// Storage-Provider kommt aus dem App-Bootstrap (createBunServer-
// options.files.storageProvider). Wir greifen darauf via ctx — der
// Hook-ctx hat aktuell nur db/tenantId/userId, also fuer Storage-
// Calls braucht es eine Erweiterung. S2.U3 Export-Job-Pipeline regelt
// das (Job-ctx hat ctx.files.ref(key)). Hier lassen wir Storage-
// Cleanup als TODO und faellen das in S2.U5 nochmal an.

export const fileRefExportHook: UserDataExportHook = async (ctx) => {
  const rawRows = await selectMany(ctx.db, fileRefsTable, { tenantId: ctx.tenantId, insertedById: ctx.userId });

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

export const fileRefDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  if (strategy === "delete") {
    // Hard-delete der FileRef-Rows fuer diesen User in diesem Tenant.
    // Storage-Binary-Cleanup folgt in S2.U5 wenn der Forget-Job-Ctx
    // den Storage-Provider exposed.
    await deleteMany(ctx.db, fileRefsTable, { tenantId: ctx.tenantId, insertedById: ctx.userId });
  } else {
    // anonymize: insertedById=null, FileRef + binary bleiben.
    // Use-case: shared chat-Attachment in einem Multi-User-Channel —
    // Author-Identifikation raus, Datei bleibt fuer andere User
    // sichtbar.
    await updateMany(ctx.db, fileRefsTable, { insertedById: null }, { tenantId: ctx.tenantId, insertedById: ctx.userId });
  }
};
