// Single source of truth fuer die Feature-Komposition der Demo-App.
//
// **Was hier gemountet wird:**
//   - data-retention            Retention-Policies (delete-after etc.)
//   - compliance-profiles       Region-Profile (eu-dsgvo etc.)
//   - file-foundation/files     File-Refs + Provider-Plugin-Host
//   - file-provider-inmemory    Provider-Plugin (kein S3 fuer Demo)
//   - user-data-rights          DSGVO Art. 15+17+18+20 Pipeline
//   - user-data-rights-defaults Default-Hooks fuer user + fileRef
//   - todos                     Demo-Domain mit eigenen EXT_USER_DATA-Hooks
//
// composeFeatures (auth-mode in runDevApp) ergaenzt config + user +
// tenant + auth-email-password automatisch.
//
// **Prod-Storage:** Die Demo nutzt file-provider-inmemory, damit sie ohne
// S3-Credentials laeuft — Exporte ueberleben aber keinen Restart. Fuer einen
// echten Deploy auf den persistenten Provider wechseln; die
// deployment-spezifischen Produktionsschritte stehen in der privaten
// Operations-Dokumentation:
//   import { createFileProviderS3Feature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
//   createFileProviderInMemoryFeature() -> createFileProviderS3Feature({ fromEnv: true })
//   + S3_BUCKET/S3_REGION/S3_ACCESS_KEY/S3_SECRET_KEY env vars
//   + appOverride "file-foundation:config:provider" = "s3-env"

import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createFileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { todosFeature } from "./feature";

export const APP_FEATURES = [
  localeDe(),
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createFileFoundationFeature(),
  // Demo: in-memory (no creds). Prod: createFileProviderS3Feature({ fromEnv: true }) — see header.
  createFileProviderInMemoryFeature(),
  createFilesFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
  todosFeature,
] as const;

export const HAS_AUTH = true;
