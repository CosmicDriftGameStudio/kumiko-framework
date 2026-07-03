import {
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { apiTokenDeleteHook, apiTokenExportHook } from "./hooks/api-token.userdata-hook";
import { configValueDeleteHook, configValueExportHook } from "./hooks/config-value.userdata-hook";
import { fileRefDeleteHook, fileRefExportHook } from "./hooks/file-ref.userdata-hook";
import {
  inAppMessageDeleteHook,
  inAppMessageExportHook,
} from "./hooks/in-app-message.userdata-hook";
import {
  notificationPreferenceDeleteHook,
  notificationPreferenceExportHook,
} from "./hooks/notification-preference.userdata-hook";
import {
  tenantInvitationDeleteHook,
  tenantInvitationExportHook,
} from "./hooks/tenant-invitation.userdata-hook";
import { userDeleteHook, userExportHook } from "./hooks/user.userdata-hook";
import { userSessionDeleteHook, userSessionExportHook } from "./hooks/user-session.userdata-hook";

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
// Binary storage for the fileRef delete-hook is resolved at run time from the
// mounted file-foundation via ctx.buildStorageProvider (injected by the forget
// orchestrator) — no provider is captured here, so a single app-wide store and
// per-tenant stores both work, and forget deletes from the same store upload +
// export use. See hooks/file-ref.userdata-hook.ts.
export function createUserDataRightsDefaultsFeature(): FeatureDefinition {
  return defineFeature("user-data-rights-defaults", (r) => {
    r.describe(
      "Registers ready-made `EXT_USER_DATA` export and delete hooks for the bundled entities that hold per-user data: `user` (delete strategy sets email to `deleted-<id>@anonymized.invalid`, nulls `passwordHash`, sets status to `Deleted`; anonymize strategy sets email to `anonymized-<id>@anonymized.invalid` without touching `passwordHash`), `fileRef` (delete removes both the DB row and the storage binary), plus — gated on the source feature being mounted — `user-session` (ip/userAgent, hard-delete), `api-token` (hard-delete = revoke), `in-app-message` (hard-delete), `tenant-invitation` (invitee email forgotten/pseudonymized, inviter link severed), `notification-preference` and user-scoped `config-value` (purged via the forget verb). Mount this alongside `user-data-rights` for standard GDPR compliance; omit it only if your app needs custom anonymization logic for these entities.",
    );
    r.uiHints({
      displayLabel: "User Data Rights · Default Hooks",
      category: "compliance",
      recommended: false,
    });
    r.requires("user", "files", "user-data-rights");
    // Optional sources: hooks are registered unconditionally but each one
    // no-ops at runtime when its source feature isn't mounted (see
    // hooks/feature-mounted.ts) — the export runner has no per-hook
    // try/catch, so a query against a missing table would kill the job.
    r.optionalRequires(
      "sessions",
      "personal-access-tokens",
      "channel-in-app",
      "tenant",
      "delivery",
      "config",
    );

    r.useExtension(EXT_USER_DATA, "user", {
      export: userExportHook,
      delete: userDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "fileRef", {
      export: fileRefExportHook,
      delete: fileRefDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "user-session", {
      export: userSessionExportHook,
      delete: userSessionDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "api-token", {
      export: apiTokenExportHook,
      delete: apiTokenDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "in-app-message", {
      export: inAppMessageExportHook,
      delete: inAppMessageDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "tenant-invitation", {
      export: tenantInvitationExportHook,
      delete: tenantInvitationDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "notification-preference", {
      export: notificationPreferenceExportHook,
      delete: notificationPreferenceDeleteHook,
    });

    r.useExtension(EXT_USER_DATA, "config-value", {
      export: configValueExportHook,
      delete: configValueDeleteHook,
    });
  });
}
