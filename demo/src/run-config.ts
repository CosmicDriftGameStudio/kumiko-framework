// Single source of truth for your app's feature composition.
// config/user/tenant/auth-email-password get added automatically via
// composeFeatures(includeBundled:true) when runProdApp is called with
// `auth: {…}` (see bin/main.ts).
//
// Adding a new feature:
//   - bunx @cosmicdrift/kumiko-cli add feature <name>  (DX-2, automatic)
//   - or: hand-edit + add the import below

import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { tasksFeature } from "./features/tasks";

export const APP_FEATURES = [
  localeDe(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
  createUserProfileFeature(),
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  // user-data-rights-defaults requires "files" (kumiko-framework#2309)
  fileFoundationFeature,
  fileProviderInMemoryFeature,
  createFilesFeature(),
  // required by sessions' `sessionStore` extension (kumiko-framework#2309)
  authFoundationFeature,
  createSessionsFeature(),
  createDeliveryFeature(),
  createSecretsFeature(),
  tasksFeature,
] as const;
export const HAS_AUTH = true;
