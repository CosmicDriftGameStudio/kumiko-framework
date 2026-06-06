import {
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import { createFileRefDeleteHook, fileRefExportHook } from "./hooks/file-ref.userdata-hook";
import { userDeleteHook, userExportHook } from "./hooks/user.userdata-hook";

export interface UserDataRightsDefaultsOptions {
  /**
   * Wired into the fileRef delete-hook: on strategy="delete" the hook
   * calls `storageProvider.delete(key)` per row before hard-deleting
   * the row. Without it, file binaries leak on forget (Art. 17) — the
   * hook logs a one-shot warning so misconfiguration stays visible.
   */
  readonly storageProvider?: FileStorageProvider;
}

// user-data-rights-defaults — Default-Hooks für die Core-Entities
// `user` (S2.H1) und `fileRef` (S2.H2).
//
// Architektur-Entscheidung (S2.H1+H2): user-data-rights selbst kann
// nicht r.requires("user", "files") + r.useExtension(EXT_USER_DATA, ...)
// machen weil es selbst Provider von EXT_USER_DATA ist (Boot-Validator
// lehnt self-extension ab). Lösung: drittes optional-mountbares Feature
// das requires beide Sources + die useExtension-Calls macht.
//
// App-Author kann dieses Feature weglassen wenn er Custom-Hooks
// stattdessen registrieren will (z.B. "anonymize sollte den User-Row
// hard-delete" — App-spezifische Compliance-Entscheidung). Default-
// Implementierung deckt 95% der Apps ab.
//
// Pattern matched file-foundation + file-provider-s3 (separate Plugin-
// Feature), nicht user/files schreiben ihre eigenen Hooks selbst weil
// das circular-requires waere.
export function createUserDataRightsDefaultsFeature(
  options: UserDataRightsDefaultsOptions = {},
): FeatureDefinition {
  const fileRefDeleteHook = createFileRefDeleteHook(options.storageProvider);
  return defineFeature("user-data-rights-defaults", (r) => {
    r.describe(
      "Registers ready-made `EXT_USER_DATA` export and delete hooks for the two core entities: `user` (delete strategy sets email to `deleted-<id>@anonymized.invalid`, nulls `passwordHash`, sets status to `Deleted`; anonymize strategy sets email to `anonymized-<id>@anonymized.invalid` without touching `passwordHash`) and `fileRef` (delete removes both the DB row and the storage binary). Mount this alongside `user-data-rights` for standard GDPR compliance; omit it only if your app needs custom anonymization logic for these entities.",
    );
    r.requires("user", "files", "user-data-rights");

    r.useExtension(EXT_USER_DATA, "user", {
      export: userExportHook,
      delete: userDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "fileRef", {
      export: fileRefExportHook,
      delete: fileRefDeleteHook,
    });
  });
}
