import { defineFeature, type FeatureDefinition } from "../engine";
import { fileRefEntity } from "./file-ref-entity";

export { fileRefEntity } from "./file-ref-entity";

// files — `fileRef` als ganz normales ES-Entity. Upload/Delete laufen über
// den Standard-Entity-Executor (file-routes.ts: executor.create/delete →
// `fileRef.created`/`fileRef.deleted` → applyEntityEvent materialisiert
// `file_refs`). Soft-Delete/Anonymize/Restore/Retention kommen damit
// generisch aus dem Entity-Lifecycle + data-retention — keine
// file-spezifische Lösch-Logik.
//
// `r.entity` macht die Tabelle für PII-Boot-Validation +
// userData/tenantData-Extensions sichtbar und registriert die implizite
// Entity-Projektion (für rebuildProjection). Liegt im Framework neben
// file-routes + fileRefsTable; bundled-features/files re-exportiert nur.
export function createFilesFeature(): FeatureDefinition {
  return defineFeature("files", (r) => {
    r.entity("fileRef", fileRefEntity);
  });
}
