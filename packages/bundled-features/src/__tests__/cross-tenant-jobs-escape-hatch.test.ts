// fw#2914 — JobContext.db is tenant-filtered; these bundled jobs reach every tenant
// and only work because their registration declares escapeHatch.
import { describe, expect, test } from "bun:test";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createAuthMfaFeature } from "../auth-mfa/feature";
import { createDataRetentionFeature } from "../data-retention/feature";
import { createFilesTenantDataFeature } from "../files-tenant-data";
import { formDraftFeature } from "../form-draft/feature";
import { inboundMailFoundationFeature } from "../inbound-mail-foundation/feature";
import { createSecretsFeature } from "../secrets/feature";
import { createSessionsFeature } from "../sessions/feature";
import { createTenantLifecycleFeature } from "../tenant-lifecycle/feature";
import { createUserDataRightsFeature } from "../user-data-rights/feature";

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
  [formDraftFeature, "cleanup"],
  [inboundMailFoundationFeature, "inbound-mail-retention"],
  [createSecretsFeature(), "rotate"],
  [createSessionsFeature(), "cleanup"],
  [createTenantLifecycleFeature(), "run-tenant-destruction"],
  [createUserDataRightsFeature(), "run-export-jobs"],
  [createUserDataRightsFeature(), "run-forget-cleanup"],
];

describe("bundled cross-tenant jobs declare escapeHatch (fw#2914)", () => {
  for (const [feature, jobName] of crossTenantJobs) {
    test(`${feature.name}:${jobName}`, () => {
      const job = feature.jobs[jobName];
      expect(job).toBeDefined();
      expect(job?.escapeHatch?.reason.trim().length ?? 0).toBeGreaterThan(20);
    });
  }
});
