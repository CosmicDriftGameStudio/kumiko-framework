import { defineFeature, type FeatureDefinition } from "../engine/index.ts";
import { bindReferencedFilesWrite } from "./bind-referenced-files.write.ts";
import { FILE_REF_ENTITY_NAME, fileRefEntity } from "./file-ref-entity.ts";
import type { FileAccessGuard } from "./file-routes.ts";
import {
  DEFAULT_UPLOAD_SWEEP_GRACE_HOURS,
  MIN_UPLOAD_SWEEP_GRACE_HOURS,
  sweepOrphanedUploads,
} from "./sweep-orphaned-uploads.ts";
import { fileUploadLedgerTable } from "./upload-ledger.ts";

export { fileRefEntity } from "./file-ref-entity.ts";

// Upload-route policy. buildServer reads these off the `files` feature's
// exports (no parallel ServerOptions surface) and applies them to the
// /api/files routes. Storage itself is wired by mounting a `file-provider-*`
// feature — these options only tune authorization + size limits.
export type FilesFeatureOptions = {
  // Replaces the default owner-or-privileged guard entirely.
  readonly accessGuard?: FileAccessGuard;
  // Roles that bypass the default owner-check on entity-attached files.
  readonly privilegedRoles?: readonly string[];
  // Roles that may read uploads without a target field (entityType and entityId null, e.g.
  // inbox or dropzone files): they belong to no record, so the app declares who reads them
  // in the tenant. Read only, no delete; attached files stay behind their record's access.
  // Files the system generated (uploader = system user) are excluded.
  readonly unclaimedUploadReaders?: readonly string[];
  // Global upload size default (per-field `maxSize` still wins). e.g. "10mb".
  readonly maxUploadSize?: string;
  // Hours an upload may wait for its fileRef row before the hourly sweep deletes its bytes.
  // Whole hours, at least 1; default 24.
  readonly uploadSweepGraceHours?: number;
};

// `fileRef` is a regular ES entity. Uploads and deletes go through the standard
// entity executor (file-routes.ts: executor.create/delete → `fileRef.created` /
// `fileRef.deleted` → applyEntityEvent materializes `file_refs`), so soft-delete,
// anonymization, restore and retention come generically from the entity lifecycle
// and data-retention, with no file-specific deletion logic.
//
// `r.entity` exposes the table to PII boot validation and the userData/tenantData
// extensions, and registers the implicit entity projection used by
// rebuildProjection. It lives in the framework next to file-routes and
// fileRefsTable; bundled-features/files only re-exports it.
export const FILES_FEATURE = "files" as const;

function assertValidSweepGraceHours(hours: number): void {
  if (!Number.isInteger(hours) || hours < MIN_UPLOAD_SWEEP_GRACE_HOURS) {
    throw new Error(
      `createFilesFeature: uploadSweepGraceHours must be a whole number of hours >= ${MIN_UPLOAD_SWEEP_GRACE_HOURS}, got ${String(hours)}`,
    );
  }
}

export function createFilesFeature(options: FilesFeatureOptions = {}): FeatureDefinition {
  const uploadSweepGraceHours = options.uploadSweepGraceHours ?? DEFAULT_UPLOAD_SWEEP_GRACE_HOURS;
  assertValidSweepGraceHours(uploadSweepGraceHours);
  return defineFeature(FILES_FEATURE, (r) => {
    r.describe(
      "Exposes the `fileRef` entity from the framework core so that uploaded files — tracked in the `file_refs` table by `createFileRoutes` — participate in cross-feature hooks: `user-data-rights-defaults` automatically includes file blobs in GDPR exports and forget flows, and tenant-lifecycle cleanup deletes all refs on tenant destroy. Upload/download routes are registered by the server bootstrap when a `file-provider-*` feature is mounted; this feature carries their access/size policy via `createFilesFeature(opts?)`.",
    );
    r.uiHints({
      displayLabel: "Files · Metadata",
      category: "storage",
      recommended: false,
    });
    r.entity({ name: FILE_REF_ENTITY_NAME, ...fileRefEntity });
    r.writeHandler(bindReferencedFilesWrite);
    r.storeTable(fileUploadLedgerTable, { reason: "coordination.file_upload_ledger" });
    r.job({
      name: "sweep-orphaned-uploads",
      trigger: { cron: "0 * * * *" },
      perTenant: true,
      concurrency: "skip",
      handler: async (_payload, ctx) => {
        await sweepOrphanedUploads({
          db: ctx.db,
          files: ctx.services.files,
          now: ctx.tz.now(),
          graceHours: uploadSweepGraceHours,
          log: ctx.obs.log,
        });
      },
    });
    return { routeOptions: options };
  });
}
