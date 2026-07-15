// Provides the EXT_USER_DATA export/delete hooks for the `user-mfa` entity as
// a standalone feature — mount it alongside `auth-mfa` + `user-data-rights`
// when an app needs 2FA enrollment in its GDPR export/forget pipeline. Kept
// separate from `auth-mfa` (which only requires "user"/"config") so auth-mfa
// consumers without the user-data-rights stack don't pull a hard dependency.
// Mirrors folders-user-data.

import { defineFeature, EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { userMfaDeleteHook, userMfaExportHook } from "./hooks";

export const authMfaUserDataFeature = defineFeature("auth-mfa-user-data", (r) => {
  r.describe(
    "GDPR (Art. 20 export / Art. 17 erasure) coverage for the `auth-mfa` feature's `user-mfa` entity. Mounts the EXT_USER_DATA export + delete hooks so 2FA enrollment status is included in the user-data export bundle and a user's TOTP secret + recovery codes are hard-deleted (via executor.forget, rebuild-safe) on a data-subject erasure request. Kept separate from `auth-mfa` so consumers without the user-data-rights pipeline don't pull a hard dependency — requires `user-data-rights`, optionalRequires `auth-mfa`.",
  );
  r.requires("user-data-rights");
  r.optionalRequires("auth-mfa");
  r.useExtension(EXT_USER_DATA, "user-mfa", {
    export: userMfaExportHook,
    delete: userMfaDeleteHook,
  });
});
