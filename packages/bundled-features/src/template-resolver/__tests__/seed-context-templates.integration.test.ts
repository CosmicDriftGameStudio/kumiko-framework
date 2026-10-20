import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createSeedMigrationContext } from "@cosmicdrift/kumiko-framework/es-ops";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.ts";
import { seedSystemTemplate } from "../seeding.ts";
import { templateResourceEntity } from "../table.ts";
import { TemplateResolverHandlers } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const TENANT_EDITABLE = tenantEditableTemplates(["mail", "ai-prompt"], ["seed-context-welcome"]);

// Runs findTemplateResources against the table template-resolver really
// builds, so a query that assumes a column the entity does not have fails here.
let stack: TestStack;

const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(31) });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE })],
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  for (const locale of ["en", "de"]) {
    await seedSystemTemplate(stack.db, {
      slug: "seed-context-welcome",
      kind: "ai-prompt",
      locale,
      content: `Welcome (${locale})`,
      contentFormat: "plain",
    });
  }
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    {
      slug: "seed-context-welcome",
      kind: "ai-prompt",
      locale: "de",
      content: "Willkommen beim Mieter",
      contentFormat: "plain",
      variableSchema: {},
      linkedResources: {},
    },
    tenantAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

function buildContext() {
  return createSeedMigrationContext({ dispatcher: stack.dispatcher, dbRunner: stack.db });
}

describe("SeedMigrationContext.findTemplateResources on the real template table", () => {
  test("lists the system rows of a seeded template", async () => {
    const rows = await buildContext().findTemplateResources({ slug: "seed-context-welcome" });
    expect(rows.map((row) => `${row.tenantId}/${row.locale}/${row.status}`)).toEqual([
      `${SYSTEM_TENANT_ID}/de/active`,
      `${SYSTEM_TENANT_ID}/en/active`,
    ]);
  });

  test("tenantId selects the tenant override written through the API", async () => {
    const rows = await buildContext().findTemplateResources({
      tenantId: tenantAdmin.tenantId,
      slug: "seed-context-welcome",
    });
    expect(rows).toEqual([
      expect.objectContaining({
        tenantId: tenantAdmin.tenantId,
        slug: "seed-context-welcome",
        kind: "ai-prompt",
        locale: "de",
        status: "draft",
      }),
    ]);
  });
});
