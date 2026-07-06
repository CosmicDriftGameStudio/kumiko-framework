import { createAdminShellFeature } from "@cosmicdrift/kumiko-bundled-features/admin-shell";
import { createAuditFeature } from "@cosmicdrift/kumiko-bundled-features/audit";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { tierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";

export const APP_FEATURES = [
  createSecretsFeature(),
  createAuditFeature(),
  createJobsFeature(),
  tierEngineFeature,
  createAdminShellFeature(),
] as const;

export const HAS_AUTH = true;
