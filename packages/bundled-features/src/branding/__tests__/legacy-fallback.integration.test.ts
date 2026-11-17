import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTenantConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { BRANDING_QN, BRANDING_TOKENS_QUERY_QN, createBrandingFeature } from "../index.ts";
import { LEGACY_BRANDING_QN } from "../legacy-fallback.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const adminA = createTestUser({ id: 30, roles: ["TenantAdmin"], tenantId: TENANT_A });
const adminB = createTestUser({ id: 31, roles: ["TenantAdmin"], tenantId: TENANT_B });

type Tokens = { title: string; accentColor: string; layoutPreset: string };

// Stand-in for the pre-move managed-pages registration, only so the test can
// write legacy rows through config:write:set.
const legacyKeyHolder = defineFeature("managed-pages", (r) => {
  r.requires({ features: ["config"] });
  r.config({
    keys: {
      brandingTitle: createTenantConfig("text", { default: "" }),
      brandingAccentColor: createTenantConfig("text", { default: "" }),
    },
  });
});

describe("branding :: legacy managed-pages keys", () => {
  let stack: TestStack;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    stack = await setupTestStack({
      features: [createConfigFeature(), createBrandingFeature(), legacyKeyHolder],
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafePushTables(stack.db, { configValuesTable });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a value stored only under the legacy key is returned", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: LEGACY_BRANDING_QN.title, value: "Legacy A" },
      adminA,
    );
    const tokens = await stack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, adminA);
    expect(tokens.title).toBe("Legacy A");
    expect(tokens.layoutPreset).toBe("centered");
  });

  test("the new key wins over the legacy key", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: LEGACY_BRANDING_QN.accentColor, value: "#111111" },
      adminB,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "#222222" },
      adminB,
    );
    const tokens = await stack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, adminB);
    expect(tokens.accentColor).toBe("#222222");
  });

  test("a legacy value does not leak to another tenant", async () => {
    const tokens = await stack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, adminB);
    expect(tokens.title).toBe("");
  });
});
