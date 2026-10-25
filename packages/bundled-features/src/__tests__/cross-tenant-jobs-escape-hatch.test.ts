// JobContext.db is tenant-filtered; these bundled jobs reach every tenant
// and only work because their registration declares escapeHatch.
import { describe, expect, test } from "bun:test";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createAuthMfaFeature } from "../auth-mfa/feature.ts";
import { createDataRetentionFeature } from "../data-retention/feature.ts";
import { createFilesTenantDataFeature } from "../files-tenant-data/index.ts";
import { createFormDraftFeature } from "../form-draft/feature.ts";
import { createInboundMailFoundationFeature } from "../inbound-mail-foundation/feature.ts";
import { createSecretsFeature } from "../secrets/feature.ts";
import { createSessionsFeature } from "../sessions/feature.ts";
import { createTenantLifecycleFeature } from "../tenant-lifecycle/feature.ts";
import { createUserDataRightsFeature } from "../user-data-rights/feature.ts";

const TEST_SECRET = "cross-tenant-jobs-escape-hatch-test-secret-0123456789";

const crossTenantJobs: ReadonlyArray<readonly [FeatureDefinition, string]> = [
  [
    createAuthMfaFeature({
      setupTokenSecret: TEST_SECRET,
      challengeTokenSecret: `${TEST_SECRET}-challenge`,
      issuer: "Kumiko",
    }),
    "reencrypt",
  ],
  [createDataRetentionFeature(), "retention-cleanup"],
  [createFilesTenantDataFeature(), "sweep-orphaned-derivatives"],
  [createFormDraftFeature(), "cleanup"],
  [createInboundMailFoundationFeature(), "inbound-mail-retention"],
  [createSecretsFeature(), "rotate"],
  [createSessionsFeature(), "cleanup"],
  [createTenantLifecycleFeature(), "run-tenant-destruction"],
  [createUserDataRightsFeature(), "run-export-jobs"],
  [createUserDataRightsFeature(), "run-forget-cleanup"],
];

describe("bundled cross-tenant jobs declare escapeHatch", () => {
  for (const [feature, jobName] of crossTenantJobs) {
    test(`${feature.name}:${jobName}`, () => {
      const job = feature.jobs[jobName];
      expect(job).toBeDefined();
      expect(job?.escapeHatch?.reason.trim()).not.toBe("");
    });
  }
});
