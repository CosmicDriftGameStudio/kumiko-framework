// Single source of truth für die Feature-Komposition deiner App.
// config/user/tenant/auth-email-password werden via
// composeFeatures(includeBundled:true) automatisch ergänzt wenn
// runProdApp mit `auth: {…}` aufgerufen wird (siehe bin/main.ts).
//
// Neue features hinzufügen:
//   - bunx @cosmicdrift/kumiko-cli add feature <name>  (DX-2, automatisch)
//   - oder: hand-edit + import unten ergänzen

import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import { tasksFeature } from "./features/tasks";

export const APP_FEATURES = [
  createUserProfileFeature(),
  createUserDataRightsFeature(),
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createSessionsFeature(),
  createDeliveryFeature(),
  createSecretsFeature(),
  tasksFeature,
] as const;
export const HAS_AUTH = true;
