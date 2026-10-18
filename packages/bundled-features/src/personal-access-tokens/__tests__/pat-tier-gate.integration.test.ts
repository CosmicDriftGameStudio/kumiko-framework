import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import {
  PAT_FEATURE,
  PAT_MINT_SCREEN_ID,
  PAT_SCREEN_ID,
  PatHandlers,
  PatQueries,
} from "../constants.ts";
import { createPersonalAccessTokensFeature } from "../feature.ts";

const TENANT_WITH_TIER = testTenantId(11);
const TENANT_WITHOUT_TIER = testTenantId(12);
const LOCKED_FALLBACK_SCREEN = "billing:screen:upgrade";
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
      createPersonalAccessTokensFeature({
        scopes: {},
        toggleable: { default: false },
        lockedFallbackScreen: LOCKED_FALLBACK_SCREEN,
      }),
      createAuthFoundationFeature(),
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

describe("GET /api/schema for a tenant whose tier excludes tokens", () => {
  type SchemaBody = {
    features: Array<{
      featureName: string;
      screens: Array<{ id: string; fallback?: string }>;
      navs?: Array<{ id: string }>;
    }>;
  };

  async function patFeatureSchema(user: typeof adminWithTier) {
    const token = await stack.jwt.sign(user);
    const res = await stack.app.request("/api/schema", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SchemaBody;
    return body.features.find((f) => f.featureName === PAT_FEATURE);
  }

  test("keeps the token screens with their fallback so the upgrade screen can render", async () => {
    const pat = await patFeatureSchema(adminWithoutTier);
    expect(pat?.screens.map((s) => s.id).sort()).toEqual(
      [PAT_MINT_SCREEN_ID, PAT_SCREEN_ID].sort(),
    );
    for (const screen of pat?.screens ?? []) {
      expect(screen.fallback).toBe(LOCKED_FALLBACK_SCREEN);
    }
    expect(pat?.navs).toBeUndefined();
  });

  test("the availability probe that gates those screens is rejected for that tenant", async () => {
    const res = await stack.http.query(PatQueries.availability, {}, adminWithoutTier);
    expect(res.status).not.toBe(200);
  });
});
