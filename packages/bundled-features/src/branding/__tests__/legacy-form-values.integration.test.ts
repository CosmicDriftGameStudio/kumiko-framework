import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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

const TENANT = "44444444-4444-4444-8444-444444444444";
const admin = createTestUser({ id: 40, roles: ["TenantAdmin"], tenantId: TENANT });

type Tokens = { title: string; accentColor: string; layoutPreset: string };
type Values = Record<string, { value: string | undefined; source: string }>;

// Stand-in for the pre-move managed-pages registration, only so the test can
// write legacy rows through config:write:set.
const legacyKeyHolder = defineFeature("managed-pages", (r) => {
  r.requires({ features: ["config"] });
  r.config({
    keys: {
      brandingTitle: createTenantConfig("text", { default: "" }),
      brandingAccentColor: createTenantConfig("text", { default: "" }),
      brandingLayoutPreset: createTenantConfig("text", { default: "" }),
    },
  });
});

describe("branding :: settings form reads legacy-only values", () => {
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

  const formValues = () =>
    stack.http.queryOk<Values>(
      "config:query:values",
      { keys: [BRANDING_QN.title, BRANDING_QN.accentColor, BRANDING_QN.layoutPreset] },
      admin,
    );
  const tokens = () => stack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, admin);

  test("a value stored only under the legacy key shows in the form values", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: LEGACY_BRANDING_QN.title, value: "Legacy Title" },
      admin,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: LEGACY_BRANDING_QN.layoutPreset, value: "wide" },
      admin,
    );
    const values = await formValues();
    expect(values[BRANDING_QN.title]?.value).toBe("Legacy Title");
    expect(values[BRANDING_QN.layoutPreset]?.value).toBe("wide");
    // Nothing legacy for this key: the form sees the plain default.
    expect(values[BRANDING_QN.accentColor]?.value).toBe("");
    expect((await tokens()).title).toBe("Legacy Title");
  });

  test("saving through the form writes the new key, which then wins", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.title, value: "New Title", scope: "tenant" },
      admin,
    );
    const values = await formValues();
    expect(values[BRANDING_QN.title]?.value).toBe("New Title");
    expect((await tokens()).title).toBe("New Title");
  });

  test("clearing the new key stays empty and does not fall back to the legacy value", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.title, value: "", scope: "tenant" },
      admin,
    );
    const values = await formValues();
    expect(values[BRANDING_QN.title]?.value).toBe("");
    expect((await tokens()).title).toBe("");
  });
});
