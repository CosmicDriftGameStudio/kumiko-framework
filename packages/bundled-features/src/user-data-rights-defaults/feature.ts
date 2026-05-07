import {
  EXT_USER_DATA,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefDeleteHook, fileRefExportHook } from "./hooks/file-ref.userdata-hook";
import { userDeleteHook, userExportHook } from "./hooks/user.userdata-hook";

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
export function createUserDataRightsDefaultsFeature(): FeatureDefinition {
  return defineFeature("user-data-rights-defaults", (r) => {
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
