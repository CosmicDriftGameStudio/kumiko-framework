import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import {
  BRANDING_QN,
  BRANDING_TOKENS_QUERY_QN,
  createBrandingCssFeature,
  createBrandingFeature,
} from "../index.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const adminA = createTestUser({ id: 20, roles: ["TenantAdmin"], tenantId: TENANT_A });
const adminB = createTestUser({ id: 21, roles: ["TenantAdmin"], tenantId: TENANT_B });

type Tokens = { title: string; accentColor: string; customCss?: string };

describe("branding :: standalone (no managed-pages)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    stack = await setupTestStack({
      features: [createConfigFeature(), createBrandingFeature()],
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

  test("a tenant admin sets title and accent color; the tokens query returns them", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.title, value: "Acme A" },
      adminA,
    );
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "#ff8800" },
      adminA,
    );
    const tokens = await stack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, adminA);
    expect(tokens.title).toBe("Acme A");
    expect(tokens.accentColor).toBe("#ff8800");
  });

  test("tenant B does not see the branding of tenant A", async () => {
    const tokens = await stack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, adminB);
    expect(tokens.title).toBe("");
    expect(tokens.accentColor).toBe("");
  });

  test("customCss is not a registered key without allowCustomCss", async () => {
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".x { color: red; }" },
      adminA,
    );
    expect(error).toMatchObject({ code: "not_found", i18nKey: "config.errors.unknownKey" });
  });

  test("an invalid accent color is rejected", async () => {
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "red" },
      adminA,
    );
    expectErrorIncludes(error, "invalid_format");
  });
});

// The per-tenant gate is simulated through effectiveFeatures: A enables branding-css, B does not.
describe("branding :: custom CSS gate", () => {
  let cssStack: TestStack;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    cssStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createBrandingFeature({ allowCustomCss: true }),
        createBrandingCssFeature(),
      ],
      effectiveFeatures: (tid) =>
        tid === TENANT_A
          ? new Set(["config", "branding", "branding-css"])
          : new Set(["config", "branding"]),
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafePushTables(cssStack.db, { configValuesTable });
  });

  afterAll(async () => {
    await cssStack.cleanup();
  });

  test("toggle on: customCss is part of the tokens", async () => {
    await cssStack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".note { color: red; }" },
      adminA,
    );
    const tokens = await cssStack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, adminA);
    expect(tokens.customCss).toContain(".note");
  });

  test("toggle off: customCss stays out of the tokens", async () => {
    await cssStack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.customCss, value: ".note { color: red; }" },
      adminB,
    );
    const tokens = await cssStack.http.queryOk<Tokens>(BRANDING_TOKENS_QUERY_QN, {}, adminB);
    expect(tokens.customCss ?? "").toBe("");
  });
});
