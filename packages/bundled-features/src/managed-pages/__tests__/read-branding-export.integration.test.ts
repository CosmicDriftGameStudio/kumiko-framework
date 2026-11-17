import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import {
  BRANDING_QN,
  type BrandingTokens,
  createManagedPagesFeature,
  readBranding,
} from "../index.ts";
import { pageEntity } from "../table.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const adminA = createTestUser({ id: 20, roles: ["TenantAdmin"], tenantId: TENANT_A });
const adminB = createTestUser({ id: 21, roles: ["TenantAdmin"], tenantId: TENANT_B });

const brandingConsumer = defineFeature("branding-consumer", (r) => {
  r.requires({ features: ["config"] });
  r.queryHandler({
    name: "read",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async (_query, ctx) => readBranding(ctx.config),
  });
});

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createManagedPagesFeature({ resolveApexTenant: () => null }),
      brandingConsumer,
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("readBranding from the package barrel", () => {
  test("readBranding from the package barrel returns the tenant's branding", async () => {
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
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.layoutPreset, value: "wide" },
      adminA,
    );

    const tokens = await stack.http.queryOk<BrandingTokens>(
      "branding-consumer:query:read",
      {},
      adminA,
    );

    expect(tokens.title).toBe("Acme A");
    expect(tokens.accentColor).toBe("#ff8800");
    expect(tokens.layoutPreset).toBe("wide");
    expect(tokens.customCss).toBe("");
  });

  test("another tenant reads its own defaults, not tenant A's branding", async () => {
    const tokens = await stack.http.queryOk<BrandingTokens>(
      "branding-consumer:query:read",
      {},
      adminB,
    );

    expect(tokens.title).toBe("");
  });
});
