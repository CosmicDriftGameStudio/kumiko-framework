// Provides the EXT_USER_DATA export/delete hooks for the folder + folder-assignment
// entities as a standalone feature — mount it alongside the folders feature +
// user-data-rights when an app needs folders in its GDPR export/forget pipeline.
// Kept separate from the folders feature (which only requires "tenant") so
// folders stays usable without the user-data-rights stack. Mirrors credit-user-data.

import { defineFeature, EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import {
  folderAssignmentDeleteHook,
  folderAssignmentExportHook,
  folderDeleteHook,
  folderExportHook,
} from "./hooks";

export const foldersUserDataFeature = defineFeature("folders-user-data", (r) => {
  r.describe(
    "GDPR (Art. 20 export / Art. 17 erasure) coverage for the `folders` feature's `folder` + `folder-assignment` entities. Mounts the EXT_USER_DATA export + delete hooks so a tenant's folder tree and its entity-to-folder assignments are included in the user-data export bundle and erased on a tenant-scoped forget (single-user tenants only; multi-user + anonymize are no-ops since folder rows carry no per-user PII). Kept separate from `folders` so folder consumers without the user-data-rights pipeline don't pull a hard dependency — requires `user-data-rights`, optionalRequires `folders`.",
  );
  // user-data-rights is the hard dependency (EXT_USER_DATA host). `folders` is
  // OPTIONAL: if it's mounted toggleable(default=false) (e.g. per-tenant via
  // tier), a hard r.requires would throw an "effectively disabled" boot
  // warning even though the folder entities exist and the hooks work fine.
  r.requires("user-data-rights");
  r.optionalRequires("folders");
  r.useExtension(EXT_USER_DATA, "folder", {
    export: folderExportHook,
    delete: folderDeleteHook,
  });
  r.useExtension(EXT_USER_DATA, "folder-assignment", {
    export: folderAssignmentExportHook,
    delete: folderAssignmentDeleteHook,
  });
});
