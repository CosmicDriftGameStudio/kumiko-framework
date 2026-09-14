import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createAuditFeature } from "../audit";
import { createCryptoShreddingFeature } from "../crypto-shredding";
import { createRateLimitingFeature } from "../rate-limiting";
import { createSessionsFeature } from "../sessions";

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
