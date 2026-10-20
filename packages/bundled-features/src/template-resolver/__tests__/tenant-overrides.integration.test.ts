import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { TenantHandlers } from "../../tenant/index.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenant } from "../../tenant/seeding.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.ts";
import { templateResourceEntity } from "../table.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const TENANT_EDITABLE = tenantEditableTemplates(["mail"], ["overrides-count", "overrides-diff"]);

const SLUG = "overrides-count";
const systemAdmin = TestUsers.systemAdmin;
const adminOf = (index: number) =>
  createTestUser({ id: 100 + index, roles: ["TenantAdmin"], tenantId: testTenantId(index) });

let stack: TestStack;

function payload(extra: Record<string, unknown> = {}) {
  return {
    slug: SLUG,
    kind: "mail" as const,
    meta: { subject: "Hallo" },
    locale: "de",
    content: "<p>Hallo</p>",
    contentFormat: "html" as const,
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
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
      { slug: SLUG, kind: "mail" },
      systemAdmin,
    );
    expect(counts).toMatchObject({ activeOverrides: 2, draftOverrides: 1, totalTenants: 3 });
  });

  test("the locale filter narrows the rows counted", async () => {
    const counts = await stack.http.queryOk(
      TemplateResolverQueries.tenantOverrides,
      { slug: SLUG, kind: "mail", locale: "en" },
      systemAdmin,
    );
    expect(counts).toMatchObject({ activeOverrides: 0, draftOverrides: 1, totalTenants: 3 });
  });

  test("a TenantAdmin is denied", async () => {
    const err = await stack.http.queryErr(
      TemplateResolverQueries.tenantOverrides,
      { slug: SLUG, kind: "mail" },
      adminOf(1),
    );
    expect(err.httpStatus).toBe(403);
  });
});

type OverrideRows = {
  rows: {
    tenantId: string;
    tenantName: string;
    status: string;
    version: number;
    locale: string;
    changedAt: string;
    changedBy: string | null;
  }[];
  diff: { identical: boolean; blocks: { change: string }[] } | null;
};

describe("template-resolver :: tenant-overrides rows", () => {
  test("lists each enabled tenant once with name, status and version, sorted by name", async () => {
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.tenantOverrides,
      { slug: SLUG, kind: "mail" },
      systemAdmin,
    )) as OverrideRows;

    expect(result.rows.map((row) => [row.tenantName, row.status])).toEqual([
      ["T1", "active"],
      ["T2", "active"],
      ["T3", "draft"],
    ]);
    expect(result.rows[0]?.tenantId).toBe(testTenantId(1));
    expect(result.rows[0]?.version).toBeGreaterThanOrEqual(1);
    expect(Number.isNaN(Date.parse(result.rows[0]?.changedAt ?? ""))).toBe(false);
    // The test users are not in the user table, so there is no name to show.
    expect(result.rows[0]?.changedBy).toBeNull();
    expect(result.diff).toBeNull();
  });

  test("diffTenantId returns the block diff of that tenant against the system template", async () => {
    const slug = "overrides-diff";
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      payload({ slug, content: "<p>Hallo</p><p>Gleich</p>" }),
      systemAdmin,
    );
    const author = await seedUser(stack.db, {
      email: "anna.berger@example.com",
      displayName: "Anna Berger",
      emailVerified: true,
    });
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      payload({ slug, status: "active", content: "<p>Guten Tag</p><p>Gleich</p>" }),
      createTestUser({ id: author.id, roles: ["TenantAdmin"], tenantId: testTenantId(2) }),
    );

    const result = (await stack.http.queryOk(
      TemplateResolverQueries.tenantOverrides,
      { slug, kind: "mail", diffTenantId: testTenantId(2) },
      systemAdmin,
    )) as OverrideRows;

    expect(result.rows[0]?.changedBy).toBe("Anna Berger");
    expect(result.diff?.identical).toBe(false);
    expect(result.diff?.blocks.map((block) => block.change)).toContain("same");
    expect(result.diff?.blocks.some((block) => block.change !== "same")).toBe(true);
  });

  test("a diff for a tenant without an override is null", async () => {
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.tenantOverrides,
      { slug: SLUG, kind: "mail", diffTenantId: testTenantId(4) },
      systemAdmin,
    )) as OverrideRows;
    expect(result.diff).toBeNull();
  });
});
