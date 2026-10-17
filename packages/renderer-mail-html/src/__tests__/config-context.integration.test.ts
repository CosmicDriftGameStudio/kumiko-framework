import { localeDe } from "@cosmicdrift/kumiko-locale-de";
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

// The German footer labels come from the locale package, as in an app that mounts it.
localeDe();

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
const siteUrlFallbackTenant: TenantId = testTenantId(43);
const logoUrlAdmin = createTestUser({ id: 44, roles: ["TenantAdmin"], tenantId: testTenantId(44) });
const FALLBACK_SITE_URL = "https://fallback.muster.example/status";
const BRANDING_LOGO_URL = "https://cdn.muster.example/logo.png";

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
      createRendererMailHtmlFeature({
        footer: ({ locale }) => ({
          text: "Sent via Demo <Platform>",
          imprint: {
            label: locale.startsWith("de") ? "Impressum" : "Imprint",
            url: "https://demo.example/impressum",
          },
          privacy: { label: "Datenschutz", url: "javascript:alert(1)" },
        }),
        brandSuffix: () => "Status",
        siteUrl: ({ ctx }) => (ctx.tenantId === siteUrlFallbackTenant ? FALLBACK_SITE_URL : null),
      }),
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

function configFor(tenantId: TenantId) {
  const systemUser = createSystemUser(tenantId);
  return createConfigAccessorFactory(
    stack.registry,
    resolver,
  )({
    user: { id: systemUser.id, tenantId },
    db: createTenantDb(stack.db, tenantId, "tenant"),
  });
}

async function renderDraftBody(tenantId: TenantId, content: string) {
  const result = await plugin.render(
    {
      kind: "mail",
      payload: {
        slug: SLUG,
        locale: "de",
        variables: {},
        unsubscribeUrl: "https://demo.example/unsub?t=1",
        draft: { content, meta: { subject: "Hinweis" } },
      },
    },
    { db: stack.db, registry: stack.registry, tenantId, config: configFor(tenantId) },
  );
  if (result.kind !== "mail") throw new Error(`unexpected render kind ${result.kind}`);
  return result;
}

async function renderIncidentDraft(tenantId: TenantId, stage: string) {
  const result = await plugin.render(
    {
      kind: "mail",
      payload: {
        slug: SLUG,
        locale: "de",
        variables: {
          stage,
          eventLabel: "Neuer Incident <A&B>",
          tone: "warning",
          title: "API langsam",
        },
        unsubscribeUrl: "https://demo.example/unsub?t=1",
        draft: {
          content:
            '<h1><span data-variable="title"></span></h1><div data-steps="stage"><span data-step="investigating">Untersucht</span><span data-step="identified">Identifiziert</span><span data-step="resolved">Behoben</span></div><p>Text</p>',
          meta: {
            subject: "{{title}}",
            headerChip: "{{eventLabel}}",
            tone: "{{tone}}",
            footerNote: "Du erhältst diese Mail, weil du <Acme> abonniert hast.",
          },
        },
      },
    },
    { db: stack.db, registry: stack.registry, tenantId, config: configFor(tenantId) },
  );
  if (result.kind !== "mail") throw new Error(`unexpected render kind ${result.kind}`);
  return result.html;
}

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

describe("renderer-mail-html :: in-code layout and platform footer", () => {
  test("without a layout row the mail shows the tenant name on top and the branding accent", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.accentColor, value: "#ab12cd", scope: "tenant" },
      configuredAdmin,
    );
    const html = await renderInvoice(configuredAdmin.tenantId);
    expect(html).toContain('lang="de"');
    expect(html.split("Muster AG").length).toBeGreaterThan(2);
    expect(html).toContain("#ab12cd");
  });

  test("chip, tone, steps, brand row and the card footer render from the template and the branding", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.siteUrl, value: "https://status.muster.example", scope: "tenant" },
      configuredAdmin,
    );
    const html = await renderIncidentDraft(configuredAdmin.tenantId, "identified");
    expect(html).toContain("Neuer Incident &lt;A&amp;B&gt;</span>");
    expect(html).not.toContain("&amp;amp;");
    expect(html).not.toContain("<A&B>");
    expect(html).toContain("background-color:#F2B53A");
    expect(html).toContain(">M</span>");
    expect(html).toContain(">Status</span>");
    expect(html).toMatch(/font-size:30px[^"]*">API langsam<\/h1>/);
    expect(html.match(/border-radius:2px;background-color:#F2B53A/g)).toHaveLength(2);
    expect(html).toContain("weil du &lt;Acme&gt; abonniert hast.");
    expect(html).toContain('href="https://status.muster.example"');
    expect(html).toContain(">status.muster.example</a>");
    expect(html).toContain(">Abmelden</a>");
    expect(html.indexOf("Abmelden")).toBeLessThan(html.indexOf("Sent via Demo"));
  });

  test("the footer resolver adds escaped text and safe links, an unsafe link is dropped", async () => {
    const html = await renderInvoice(untouchedTenant);
    expect(html).toContain("Sent via Demo &lt;Platform&gt;");
    expect(html).toContain('href="https://demo.example/impressum"');
    expect(html).toContain("Impressum");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("#ab12cd");
  });
});

describe("renderer-mail-html :: branding logo address and site link fallback", () => {
  test("the logo address the branding mask stores shows in the brand row at 28px and in a body logo image", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.logoUrl, value: BRANDING_LOGO_URL, scope: "tenant" },
      logoUrlAdmin,
    );
    const result = await renderDraftBody(
      logoUrlAdmin.tenantId,
      '<p>Hallo</p><p><img data-resource="logo" alt="Logo"></p>',
    );
    expect(result.html).toContain(`<img src="${BRANDING_LOGO_URL}" alt="" height="28"`);
    expect(result.html.split(`src="${BRANDING_LOGO_URL}"`)).toHaveLength(3);
    expect(result.attachments ?? []).toHaveLength(0);
  });

  test("without a branding site URL the site URL resolver supplies the card's site link", async () => {
    const result = await renderDraftBody(siteUrlFallbackTenant, "<p>Hallo</p>");
    expect(result.html).toContain(`href="${FALLBACK_SITE_URL}"`);
    expect(result.html).toContain(">fallback.muster.example</a>");
  });

  test("without any site URL the card footer keeps only the unsubscribe link", async () => {
    const result = await renderDraftBody(untouchedTenant, "<p>Hallo</p>");
    expect(result.html).not.toContain('href=""');
    expect(result.html).toContain(">Abmelden</a>");
    expect(result.html).not.toMatch(/·\s*<a[^>]*>Abmelden/);
    expect(result.html).not.toContain("<img");
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

  test("a tenant layout cannot drop the platform footer", async () => {
    const html = await renderInvoice(configuredAdmin.tenantId);
    expect(html).toContain("Kopf");
    expect(html).toContain('href="https://demo.example/impressum"');
  });
});
