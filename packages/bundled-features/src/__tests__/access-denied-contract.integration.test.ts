import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectRoleRestrictedHandlersDenyForeignRole } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createAccountSecurityFeature } from "../account-security/index.ts";
import { createAgentToolsFeature } from "../agent-tools/feature.ts";
import { createAuditFeature } from "../audit/feature.ts";
import { createAuthEmailPasswordFeature } from "../auth-email-password/feature.ts";
import { createAuthFoundationFeature } from "../auth-foundation/index.ts";
import { createAuthMfaFeature } from "../auth-mfa/index.ts";
import { createCapCounterFeature } from "../cap-counter/feature.ts";
import { createComplianceProfilesFeature } from "../compliance-profiles/feature.ts";
import { createConfigFeature } from "../config/index.ts";
import { createCustomFieldsFeature } from "../custom-fields/feature.ts";
import { createDataRetentionFeature } from "../data-retention/feature.ts";
import { createFeatureTogglesFeature } from "../feature-toggles/feature.ts";
import { createFoldersFeature } from "../folders/feature.ts";
import { createFormDraftFeature } from "../form-draft/index.ts";
import { createLedgerFeature } from "../ledger/feature.ts";
import { createLegalPagesFeature } from "../legal-pages/feature.ts";
import { createNotesHistoryFeature } from "../notes-history/feature.ts";
import { createPersonalAccessTokensFeature } from "../personal-access-tokens/feature.ts";
import { createRateLimitingFeature } from "../rate-limiting/index.ts";
import { createRendererFoundationFeature } from "../renderer-foundation/feature.ts";
import { createSecretsFeature } from "../secrets/feature.ts";
import { createSessionsFeature } from "../sessions/index.ts";
import { createStepDispatcherFeature } from "../step-dispatcher/feature.ts";
import { createTagsFeature } from "../tags/index.ts";
import { createTemplateResolverFeature } from "../template-resolver/feature.ts";
import { createTenantFeature } from "../tenant/index.ts";
import { createTenantLifecycleFeature } from "../tenant-lifecycle/index.ts";
import { createTenantSettingsFeature } from "../tenant-settings/feature.ts";
import { createUserFeature } from "../user/feature.ts";
import { createWorkflowRunnerFeature } from "../workflow-runner/index.ts";
import { testAuthMfaOptions } from "./auth-mfa-test-options.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createAuthMfaFeature(testAuthMfaOptions),
      createAccountSecurityFeature(),
      createAuditFeature(),
      createTenantLifecycleFeature(),
      createComplianceProfilesFeature(),
      createFeatureTogglesFeature(),
      createSecretsFeature(),
      createTagsFeature(),
      createFoldersFeature(),
      createCapCounterFeature(),
      createDataRetentionFeature(),
      createPersonalAccessTokensFeature({ scopes: {} }),
      createTenantSettingsFeature(),
      createRateLimitingFeature(),
      createWorkflowRunnerFeature(),
      createStepDispatcherFeature(),
      createFormDraftFeature(),
      createNotesHistoryFeature(),
      createLedgerFeature(),
      createCustomFieldsFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createLegalPagesFeature(),
      createAgentToolsFeature(),
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("access-denied contract across bundled features", () => {
  test("every role-restricted handler answers 403 access_denied to a foreign role", async () => {
    // Floor, not the exact count: guards against the registry walk going empty.
    const result = await expectRoleRestrictedHandlersDenyForeignRole(stack, {
      minimumHandlerCount: 120,
    });

    expect(result.checkedWriteHandlers).toBeGreaterThan(0);
    expect(result.checkedQueryHandlers).toBeGreaterThan(0);
  });
});
