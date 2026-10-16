// The renderer reads locale, currency and the tenant name through ctx.config.
// Values are set over the normal config write handler and read back through the
// real accessor factory, so the cascade (tenant value over feature default) is
// the production one.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  BRANDING_QN,
  createManagedPagesFeature,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  createRendererFoundationFeature,
  type RendererPlugin,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  TemplateResolverHandlers,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import {
  createTenantSettingsFeature,
  TenantSettingsConfig,
} from "@cosmicdrift/kumiko-bundled-features/tenant-settings";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { setupAppTestStack } from "@cosmicdrift/kumiko-testing";
import * as z from "zod";
import { createRendererMailHtmlFeature } from "../feature";

const SLUG = "mail-config-demo:notify:invoice";

const mailConfigDemo = defineFeature("mail-config-demo", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("invoice", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    variables: {
      total: templateVariable.money(),
      due: templateVariable.date(),
    },
    template: {
      de: {
        body: '<p>Summe <span data-variable="total"></span> fällig <span data-variable="due"></span> bei <span data-variable="tenantName"></span></p>',
      },
    },
    meta: { de: { subject: "Rechnung" } },
  });
});

const configuredAdmin = createTestUser({
  id: 41,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(41),
});
const untouchedTenant: TenantId = testTenantId(42);

const resolver = createConfigResolver();
let stack: TestStack;
let plugin: RendererPlugin;

beforeAll(async () => {
  stack = await setupAppTestStack(
    [
      createConfigFeature(),
      createTenantSettingsFeature(),
      createManagedPagesFeature({ resolveApexTenant: () => null }),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      mailConfigDemo,
    ],
    {
      includeBundled: false,
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    },
  );
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
  await unsafePushTables(stack.db, { configValuesTable });
  await seedNotificationTemplates(stack.db, stack.registry);
  plugin = createRendererFoundationApi(
    collectRendererPlugins(stack.registry),
  ).createRendererForTenant({ tenantId: configuredAdmin.tenantId, kind: "mail" });

  for (const [key, value] of [
    [TenantSettingsConfig.locale, "en"],
    [TenantSettingsConfig.currency, "CHF"],
    [BRANDING_QN.title, "Muster AG"],
  ] as const) {
    await stack.http.writeOk("config:write:set", { key, value, scope: "tenant" }, configuredAdmin);
  }
});

afterAll(async () => {
  await stack.cleanup();
});

async function renderInvoice(tenantId: TenantId) {
  const systemUser = createSystemUser(tenantId);
  const config = createConfigAccessorFactory(
    stack.registry,
    resolver,
  )({
    user: { id: systemUser.id, tenantId },
    db: createTenantDb(stack.db, tenantId, "tenant"),
  });
  const result = await plugin.render(
    {
      kind: "mail",
      payload: {
        slug: SLUG,
        locale: "de",
        variables: { total: 123456, due: "2026-03-05" },
      },
    },
    { db: stack.db, registry: stack.registry, tenantId, config },
  );
  if (result.kind !== "mail") throw new Error(`unexpected render kind ${result.kind}`);
  return result.html;
}

describe("renderer-mail-html :: ctx.config", () => {
  test("currency and tenant name come from the tenant config, date and number format from the German template, not the tenant's English locale", async () => {
    const html = await renderInvoice(configuredAdmin.tenantId);
    expect(html).toContain("CHF");
    expect(html).toContain("1.234,56");
    expect(html).toContain("5. März 2026");
    expect(html).not.toContain("Mar 5, 2026");
    expect(html).toContain("Muster AG");
  });

  test("a tenant without config values gets the feature defaults, not another tenant's values", async () => {
    const html = await renderInvoice(untouchedTenant);
    expect(html).not.toContain("CHF");
    expect(html).not.toContain("Muster AG");
    expect(html).toContain("1.234,56 €");
  });
});

describe("renderer-mail-html :: layout accent line", () => {
  const layout = (accentLine: "branding" | "none") => ({
    slug: "default",
    kind: "mail-layout" as const,
    locale: "de",
    content: "<div data-header><p>Kopf</p></div><div data-content></div>",
    contentFormat: "html" as const,
    meta: { accentLine },
    variableSchema: {},
    linkedResources: {},
    status: "active" as const,
  });

  test("the branding accent color draws the top line only when the layout asks for it", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "#ab12cd", scope: "tenant" },
      configuredAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      layout("none"),
      configuredAdmin,
    );
    expect(await renderInvoice(configuredAdmin.tenantId)).not.toContain("#ab12cd");
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      layout("branding"),
      configuredAdmin,
    );
    expect(await renderInvoice(configuredAdmin.tenantId)).toContain("#ab12cd");
  });
});
