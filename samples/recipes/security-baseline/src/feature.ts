// Security-Baseline Sample
// Shows: mounting securityBaselineFeatures() (sessions, crypto-shredding,
// rate-limiting, audit) and how it silences the NODE_ENV=production boot
// warning that fires when one of those four is missing.

import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { securityBaselineFeatures } from "@cosmicdrift/kumiko-bundled-features/presets";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export const APP_FEATURES: FeatureDefinition[] = [
  createConfigFeature(),
  createUserFeature(),
  createTenantFeature(),
  authFoundationFeature,
  ...securityBaselineFeatures(),
];
