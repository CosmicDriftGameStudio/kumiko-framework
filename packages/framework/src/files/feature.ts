import { defineFeature, type FeatureDefinition } from "../engine";
import { fileRefEntity } from "./file-ref-entity";
import type { FileAccessGuard } from "./file-routes";

export { fileRefEntity } from "./file-ref-entity";

// Upload-route policy. buildServer reads these off the `files` feature's
// exports (no parallel ServerOptions surface) and applies them to the
// /api/files routes. Storage itself is wired by mounting a `file-provider-*`
// feature — these options only tune authorization + size limits.
export type FilesFeatureOptions = {
  // Replaces the default owner-or-privileged guard entirely.
  readonly accessGuard?: FileAccessGuard;
  // Roles that bypass the default owner-check on entity-attached files.
  readonly privilegedRoles?: readonly string[];
  // Global upload size default (per-field `maxSize` still wins). e.g. "10mb".
  readonly maxUploadSize?: string;
};

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
export function createFilesFeature(options: FilesFeatureOptions = {}): FeatureDefinition {
  return defineFeature("files", (r) => {
    r.describe(
      "Exposes the `fileRef` entity from the framework core so that uploaded files — tracked in the `file_refs` table by `createFileRoutes` — participate in cross-feature hooks: `user-data-rights-defaults` automatically includes file blobs in GDPR exports and forget flows, and tenant-lifecycle cleanup deletes all refs on tenant destroy. Upload/download routes are registered by the server bootstrap when a `file-provider-*` feature is mounted; this feature carries their access/size policy via `createFilesFeature(opts?)`.",
    );
    r.uiHints({
      displayLabel: "Files · Metadata",
      category: "storage",
      recommended: false,
    });
    r.entity("fileRef", fileRefEntity);
    return { routeOptions: options };
  });
}
