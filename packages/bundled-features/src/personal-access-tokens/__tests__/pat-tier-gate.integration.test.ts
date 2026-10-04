import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { authFoundationFeature } from "../../auth-foundation/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createUserFeature } from "../../user/feature.js";
import { PAT_FEATURE, PatHandlers, PatQueries } from "../constants.js";
import { createPersonalAccessTokensFeature } from "../feature.js";

const TENANT_WITH_TIER = testTenantId(11);
const TENANT_WITHOUT_TIER = testTenantId(12);
const ALWAYS_ON_FEATURES = ["config", "user", "tenant", "auth-foundation"];

let stack: TestStack;
const adminWithTier = createTestUser({ id: 1, tenantId: TENANT_WITH_TIER, roles: ["Admin"] });
const adminWithoutTier = createTestUser({ id: 2, tenantId: TENANT_WITHOUT_TIER, roles: ["Admin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createPersonalAccessTokensFeature({ scopes: {}, toggleable: { default: false } }),
      authFoundationFeature,
    ],
    effectiveFeatures: (tenantId) =>
      new Set(
        tenantId === TENANT_WITH_TIER ? [...ALWAYS_ON_FEATURES, PAT_FEATURE] : ALWAYS_ON_FEATURES,
      ),
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("personal-access-tokens under a tier that excludes the feature", () => {
  test("the availability probe answers for a tenant whose tier includes tokens", async () => {
    const res = await stack.http.query(PatQueries.availability, {}, adminWithTier);
    expect(res.status).toBe(200);
  });

  test("every token query is rejected server-side, not only hidden in the UI", async () => {
    for (const type of [PatQueries.availability, PatQueries.mine, PatQueries.availableScopes]) {
      const res = await stack.http.query(type, {}, adminWithoutTier);
      expect(res.status).not.toBe(200);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("feature_disabled");
    }
  });

  test("minting and revoking are rejected server-side", async () => {
    const mint = await stack.http.write(
      PatHandlers.create,
      { name: "x", scopes: [], currentPassword: "pw" },
      adminWithoutTier,
    );
    expect(mint.status).not.toBe(200);
    expect(((await mint.json()) as { error?: { code?: string } }).error?.code).toBe(
      "feature_disabled",
    );

    const revoke = await stack.http.write(PatHandlers.revoke, { id: "x" }, adminWithoutTier);
    expect(revoke.status).not.toBe(200);
  });
});
