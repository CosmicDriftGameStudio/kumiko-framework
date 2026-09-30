import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createAuditFeature } from "../audit/index.js";
import { createCryptoShreddingFeature } from "../crypto-shredding/index.js";
import { createRateLimitingFeature } from "../rate-limiting/index.js";
import { createSessionsFeature } from "../sessions/index.js";

export type SecurityBaselineOptions = {
  readonly includeSessions?: boolean;
};

// Host app must mount user, tenant, auth-foundation (sessions/audit requires).
export function securityBaselineFeatures(opts: SecurityBaselineOptions = {}): FeatureDefinition[] {
  return [
    ...(opts.includeSessions !== false ? [createSessionsFeature()] : []),
    createCryptoShreddingFeature(),
    createRateLimitingFeature(),
    createAuditFeature(),
  ];
}
