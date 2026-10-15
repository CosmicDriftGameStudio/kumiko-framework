// Integration-Test: Plugin → Foundation-Pool-Roundtrip + End-to-End-Render
// gegen echte Test-DB (via setupTestStack). Verifiziert dass:
//   - Plugin sich am `renderer`-Extension-Point registriert
//   - Foundation findet Plugin via createRendererForTenant({ kind: "mail-html" })
//   - Plugin's render(req, ctx) liefert html + text
//   - A tenant layout override from template-resolver is preferred over
//     system + default constant (4-stage fallback)

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  createRendererFoundationFeature,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverApi,
  createTemplateResolverFeature,
  templateResourceEntity,
  templateResourcesTable,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  deleteMany,
  type EntityTable,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EntityDefinition,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { type TestStack, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-framework/stack";
import { setupAppTestStack } from "@cosmicdrift/kumiko-testing";
import { createRendererMailHtmlFeature } from "../feature";

const TENANT_A = "33333333-3333-4333-8333-333333333333" as TenantId;
// Separate tenant for the override test, so the default-fallback test
// (TENANT_A, earlier in the file) runs against an empty table.
const TENANT_OVERRIDE = "44444444-4444-4444-8444-444444444444" as TenantId;
const LOCALE = "en";
const LAYOUT_SLUG = "mail-layout";

const SYSTEM_BRAND_MARKER = "SYSTEM_LAYOUT_BRAND_X7";
const TENANT_BRAND_MARKER = "TENANT_LAYOUT_BRAND_Q9";

function brandedLayoutMjml(marker: string): string {
  return `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>${marker}</mj-text>
        <mj-raw>{{{content}}}</mj-raw>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

const templateExecutor = createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
  entityName: "template-resource",
});

async function seedLayout(
  db: DbConnection,
  tenantId: TenantId,
  scope: "system" | "tenant",
  marker: string,
): Promise<void> {
  const by = createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId, scope);
  const result = await templateExecutor.create(
    {
      tenantId,
      slug: LAYOUT_SLUG,
      kind: "mail-html",
      locale: LOCALE,
      content: brandedLayoutMjml(marker),
      contentFormat: "mjml",
      variableSchema: "{}",
      linkedResources: "{}",
      scope,
      status: "active",
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(`seedLayout(${scope}) failed — ${JSON.stringify(result)}`);
  }
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupAppTestStack(
    [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
    ],
    { includeBundled: false },
  );
  // template-resource is written here via the raw event-store executor (no
  // dispatcher projection pass), so it still needs an explicit projection
  // table instead of setupAppTestStack's auto-push.
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
});

afterAll(async () => {
  await stack.cleanup();
});

// Seeded layouts must not bleed across tests — the default-fallback test
// asserts the IN-CODE layout and would fail if an earlier test's system
// layout survived (test-order dependence).
// test-only: strip the 0.125 EXECUTOR_ONLY brand to wipe the projection directly.
async function wipeProjection<E extends EntityDefinition>(
  db: Parameters<typeof deleteMany>[0],
  table: EntityTable<E>,
): Promise<void> {
  await deleteMany(db, table as unknown as Parameters<typeof deleteMany>[1], {});
}

afterEach(async () => {
  await wipeProjection(stack.db, templateResourcesTable);
});

describe("renderer-mail-html :: Plugin-Registration + Foundation-Lookup", () => {
  test("Plugin registriert sich am 'renderer'-Extension-Point", () => {
    const plugins = collectRendererPlugins(stack.registry);
    const names = plugins.map((p) => p.name);
    expect(names).toContain("mail-html");
  });

  test("Foundation wählt mail-html für kind='mail-html' (Default)", () => {
    const plugins = collectRendererPlugins(stack.registry);
    const api = createRendererFoundationApi(plugins);
    const plugin = api.createRendererForTenant({ tenantId: TENANT_A, kind: "mail-html" });
    expect(plugin.name).toBe("mail-html");
    expect([...plugin.kinds]).toEqual(["mail-html"]);
  });
});

describe("renderer-mail-html :: E2E-Render (Default-Layout-Fallback)", () => {
  test("Render ohne Tenant/System-Layout-Template → in-code DEFAULT_MAIL_LAYOUT_MJML", async () => {
    const plugins = collectRendererPlugins(stack.registry);
    const api = createRendererFoundationApi(plugins);
    const plugin = api.createRendererForTenant({ tenantId: TENANT_A, kind: "mail-html" });
    const result = await plugin.render(
      {
        kind: "mail-html",
        payload: {
          content: "# Willkommen\n\nHallo {{name}}, schön dass du da bist.",
          contentFormat: "markdown",
          variables: { name: "Test-User", appName: "TestApp" },
          locale: LOCALE,
        },
      },
      { db: stack.db, registry: stack.registry, tenantId: TENANT_A },
    );
    expect(result.kind).toBe("mail-html");
    if (result.kind !== "mail-html") return;
    // Content + Layout-Vars in HTML
    expect(result.html).toContain("Willkommen");
    expect(result.html).toContain("Hallo Test-User");
    expect(result.html).toContain("TestApp");
    // Email-safe table-Layout
    expect(result.html).toContain("<table");
    // text-Alternative
    expect(result.text.length).toBeGreaterThan(0);
    // h1 is upper-cased in plain text (html-to-text default for headings)
    expect(result.text.toLowerCase()).toContain("willkommen");
  });
});

describe("renderer-mail-html :: Tenant-Layout-Override", () => {
  test("Tenant-eigenes Layout schlägt System + Default (4-stage-fallback)", async () => {
    // Seed system layout AND tenant layout — both active, both en.
    // resolveTemplate-Kette: [tenant/en, system/en, tenant/de, system/de].
    // tenant/en muss als erstes matchen.
    await seedLayout(stack.db, SYSTEM_TENANT_ID, "system", SYSTEM_BRAND_MARKER);
    await seedLayout(stack.db, TENANT_OVERRIDE, "tenant", TENANT_BRAND_MARKER);

    // Sanity: the resolver returns the tenant layout (not system).
    const resolved = await createTemplateResolverApi(stack.db).resolveTemplate({
      tenantId: TENANT_OVERRIDE,
      slug: LAYOUT_SLUG,
      kind: "mail-html",
      locale: LOCALE,
    });
    expect(resolved.scope).toBe("tenant");
    expect(resolved.tenantId).toBe(TENANT_OVERRIDE);

    const plugins = collectRendererPlugins(stack.registry);
    const api = createRendererFoundationApi(plugins);
    const plugin = api.createRendererForTenant({ tenantId: TENANT_OVERRIDE, kind: "mail-html" });
    const result = await plugin.render(
      {
        kind: "mail-html",
        payload: {
          content: "# Hallo\n\nContent-Marker {{name}}",
          contentFormat: "markdown",
          variables: { name: "Override-User", appName: "BrandApp" },
          locale: LOCALE,
        },
      },
      { db: stack.db, registry: stack.registry, tenantId: TENANT_OVERRIDE },
    );

    expect(result.kind).toBe("mail-html");
    if (result.kind !== "mail-html") return;
    // Discriminating: tenant marker in the output, system marker NOT — proves
    // that the tenant layout beats the system layout (and the in-code default).
    expect(result.html).toContain(TENANT_BRAND_MARKER);
    expect(result.html).not.toContain(SYSTEM_BRAND_MARKER);
    // Content is still rendered into the layout slot.
    expect(result.html).toContain("Content-Marker Override-User");
  });
});
