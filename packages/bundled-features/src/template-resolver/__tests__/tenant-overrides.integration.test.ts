import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config/feature.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { TenantHandlers } from "../../tenant/index.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenant } from "../../tenant/seeding.js";
import { createTemplateResolverFeature } from "../feature.js";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.js";
import { templateResourceEntity } from "../table.js";

const SLUG = "overrides-count";
const systemAdmin = TestUsers.systemAdmin;
const adminOf = (index: number) =>
  createTestUser({ id: 100 + index, roles: ["TenantAdmin"], tenantId: testTenantId(index) });

let stack: TestStack;

function payload(extra: Record<string, unknown> = {}) {
  return {
    slug: SLUG,
    kind: "notification" as const,
    locale: "de",
    content: "Hallo",
    contentFormat: "markdown" as const,
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature(), createTemplateResolverFeature()],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  for (const index of [1, 2, 3, 4]) {
    await seedTenant(stack.db, { id: testTenantId(index), key: `ovr-${index}`, name: `T${index}` });
  }
  await stack.http.writeOk(TenantHandlers.disable, { id: testTenantId(4) }, systemAdmin);

  await stack.http.writeOk(TemplateResolverHandlers.upsertSystem, payload(), systemAdmin);
  // Tenant 1 overrides in two locales (counts once, as active), 2 is active,
  // 3 is a draft, 4 is disabled with an active override.
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    payload({ status: "active" }),
    adminOf(1),
  );
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    payload({ locale: "en" }),
    adminOf(1),
  );
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    payload({ status: "active" }),
    adminOf(2),
  );
  await stack.http.writeOk(TemplateResolverHandlers.upsertTenant, payload(), adminOf(3));
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    payload({ status: "active" }),
    adminOf(4),
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("template-resolver :: tenant-overrides with the tenant feature", () => {
  test("counts enabled tenants only and never exceeds the total", async () => {
    const counts = await stack.http.queryOk(
      TemplateResolverQueries.tenantOverrides,
      { slug: SLUG, kind: "notification" },
      systemAdmin,
    );
    expect(counts).toEqual({ activeOverrides: 2, draftOverrides: 1, totalTenants: 3 });
  });

  test("the locale filter narrows the rows counted", async () => {
    const counts = await stack.http.queryOk(
      TemplateResolverQueries.tenantOverrides,
      { slug: SLUG, kind: "notification", locale: "en" },
      systemAdmin,
    );
    expect(counts).toEqual({ activeOverrides: 0, draftOverrides: 1, totalTenants: 3 });
  });

  test("a TenantAdmin is denied", async () => {
    const err = await stack.http.queryErr(
      TemplateResolverQueries.tenantOverrides,
      { slug: SLUG, kind: "notification" },
      adminOf(1),
    );
    expect(err.httpStatus).toBe(403);
  });
});
