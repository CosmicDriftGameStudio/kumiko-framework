import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenant } from "../../tenant/seeding.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import type { OverviewResponse } from "../index.ts";
import { templateResourceEntity } from "../table.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const SLUG = "overridden-by-count";
const systemAdmin = TestUsers.systemAdmin;
const adminOf = (index: number) =>
  createTestUser({ id: 200 + index, roles: ["TenantAdmin"], tenantId: testTenantId(index) });

let stack: TestStack;

const mailPayload = {
  slug: SLUG,
  kind: "mail" as const,
  meta: { subject: "Hallo" },
  locale: "de",
  content: "<p>Hallo</p>",
  contentFormat: "html" as const,
  variableSchema: {},
  linkedResources: {},
};

async function overview(user: ReturnType<typeof adminOf> | typeof systemAdmin) {
  return (await stack.http.queryOk(TemplateResolverQueries.overview, {}, user)) as OverviewResponse;
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({
        tenantEditable: tenantEditableTemplates(["mail"], [SLUG]),
      }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  // Index 1 is the SystemAdmin test user's own tenant, which would put its override into the admin's own view.
  for (const index of [2, 3]) {
    await seedTenant(stack.db, { id: testTenantId(index), key: `ovb-${index}`, name: `T${index}` });
  }
  await stack.http.writeOk(TemplateResolverHandlers.upsertSystem, mailPayload, systemAdmin);
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    { ...mailPayload, status: "active" },
    adminOf(2),
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("template-resolver :: overview overriddenBy", () => {
  test("a SystemAdmin sees how many of the tenants override a system template", async () => {
    const row = (await overview(systemAdmin)).rows.find((entry) => entry.slug === SLUG);
    expect(row?.origin).toBe("system");
    expect(row?.overriddenBy).toEqual({ active: 1, total: 2 });
  });

  test("a TenantAdmin gets no overriddenBy field", async () => {
    const row = (await overview(adminOf(3))).rows.find((entry) => entry.slug === SLUG);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("overriddenBy");
  });

  test("the counts query itself is denied to a TenantAdmin", async () => {
    const err = await stack.http.queryErr(
      TemplateResolverQueries.tenantOverrideCounts,
      {},
      adminOf(2),
    );
    expect(err.httpStatus).toBe(403);
  });
});
