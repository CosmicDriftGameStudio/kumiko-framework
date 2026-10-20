import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createAuditFeature } from "../audit/index.ts";
import { createCryptoShreddingFeature } from "../crypto-shredding/index.ts";
import { createRateLimitingFeature } from "../rate-limiting/index.ts";
import { createSessionsFeature } from "../sessions/index.ts";

export type SecurityBaselineOptions = {
  readonly includeSessions?: boolean;
};

// Host app must mount user, tenant, auth-foundation (sessions/audit requires).
/** @deprecated Removed in 0.390.0. Use `composeSecurityStack({ includeSessions })`
 *  from `@cosmicdrift/kumiko-dev-server/compose-stacks`. */
export function securityBaselineFeatures(opts: SecurityBaselineOptions = {}): FeatureDefinition[] {
  return [
    ...(opts.includeSessions !== false ? [createSessionsFeature()] : []),
    createCryptoShreddingFeature(),
    createRateLimitingFeature(),
    createAuditFeature(),
  ];
}
