// Security-Baseline Sample
// Shows: mounting composeSecurityStack() (sessions, crypto-shredding,
// rate-limiting, audit) and how it silences the NODE_ENV=production boot
// warning that fires when one of those four is missing.

import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { composeSecurityStack } from "@cosmicdrift/kumiko-dev-server/compose-stacks";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export const APP_FEATURES: FeatureDefinition[] = [
  createConfigFeature(),
  createUserFeature(),
  createTenantFeature(),
  createAuthFoundationFeature(),
  ...composeSecurityStack(),
];
