import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { fileUploadedPayloadSchema } from "@cosmicdrift/kumiko-framework/files";
import { fileRefEntity } from "./schema/file-ref";

export { fileRefEntity } from "./schema/file-ref";

// files — Schema-Sicht der framework-internen file_refs-Tabelle als
// bundled-feature, damit Cross-Feature-Hooks (userData, tenantData) sich
// an die "fileRef"-Entity hängen können.
//
// Sprint 1.5 (this commit):
//   - r.entity("fileRef", fileRefEntity) — Schema-Surface
//   - r.defineEvent("uploaded", schema)  — Event-Marker
//
// Sprint 2 (kommt):
//   - r.useExtension(EXT_USER_DATA, "fileRef", { export, delete })
//
// Sprint 5 (kommt):
//   - r.useExtension(EXT_TENANT_DATA, "fileRef", { destroy })
//
// Routes bleiben framework-internal (multipart-Upload + binary-Streaming
// passen nicht in das Handler-Pattern; siehe schema/file-ref.ts für
// Architektur-Note).
//
// Sprint-1.5-Plan-Roadmap-Wille: "fileRefsTable bleibt in framework
// (kein Daten-Move), aber r.entity('fileRef') deklariert sie für das
// Feature." — diese Datei IST die Umsetzung.
export function createFilesFeature(): FeatureDefinition {
  return defineFeature("files", (r) => {
    r.entity("fileRef", fileRefEntity);

    r.defineEvent("uploaded", fileUploadedPayloadSchema);
  });
}
