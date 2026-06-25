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
  // user-data-rights ist die harte Abhängigkeit (EXT_USER_DATA-Host). `folders` ist
  // OPTIONAL: ist es toggleable(default=false) gemountet (z.B. per-Tenant via Tier),
  // würde ein hartes r.requires eine „effectively disabled"-Boot-Warnung werfen,
  // obwohl die folder-Entities existieren und die Hooks korrekt greifen.
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
