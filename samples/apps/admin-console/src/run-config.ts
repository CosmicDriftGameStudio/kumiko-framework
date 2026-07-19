import { createAdminShellFeature } from "@cosmicdrift/kumiko-bundled-features/admin-shell";
import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { tierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// Only screen without access.roles in this app - admin-console otherwise
// consists solely of role-gated admin-shell screens, but createKumikoApp
// needs an open default screenQn (see client.tsx).
const homeFeature = defineFeature("home", (r) => {
  r.screen({
    id: "home",
    type: "custom",
    renderer: { react: { __component: "admin-console-home" } },
  });
  r.translations({
    keys: { "screen:home.title": { de: "Start", en: "Home" } },
  });
});

export const APP_FEATURES = [
  createSecretsFeature(),
  createAuditFeature(),
  createJobsFeature(),
  tierEngineFeature,
  createAdminShellFeature(),
  homeFeature,
] as const;

export const HAS_AUTH = true;
