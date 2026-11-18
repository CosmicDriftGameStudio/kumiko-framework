// Mails the platform sends itself run under the system tenant. The platformBrand option gives
// them the app's title and accent color until branding is stored for that tenant; mails of every
// other tenant keep their own branding cascade.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BRANDING_QN, createBrandingFeature } from "@cosmicdrift/kumiko-bundled-features/branding";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  collectRendererPlugins,
  createRendererFoundationFeature,
  type RendererContext,
  type RendererPlugin,
  selectRendererPlugin,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import { createTenantSettingsFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";
import { setupAppTestStack } from "@cosmicdrift/kumiko-dev-server/testing";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createRendererMailHtmlFeature } from "../feature";

const SLUG = "platform-brand-demo:notify:notice";
const PLATFORM_TITLE = "Plattform Status";
const PLATFORM_ACCENT = "#7a3cff";
const STORED_TITLE = "Gespeicherte Marke";
const STORED_ACCENT = "#0a7d4f";
const BUTTON_BODY = '<p>Hallo</p><p><a data-button href="{{url}}">Los</a></p>';

const platformBrandDemo = defineFeature("platform-brand-demo", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification({
    name: "notice",
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    template: { de: { body: "<p>Hinweis</p>" } },
    meta: { de: { subject: "Hinweis" } },
  });
});

const systemTenantAdmin = createTestUser({
  id: 61,
  roles: ["TenantAdmin"],
  tenantId: SYSTEM_TENANT_ID,
});
const ordinaryTenant: TenantId = testTenantId(62);

const resolver = createConfigResolver();
let stack: TestStack;
let plugin: RendererPlugin;

beforeAll(async () => {
  stack = await setupAppTestStack(
    [
      createConfigFeature(),
      createTenantSettingsFeature(),
      createBrandingFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature({
        platformBrand: { title: PLATFORM_TITLE, accentColor: PLATFORM_ACCENT },
      }),
      platformBrandDemo,
    ],
    {
      includeBundled: false,
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    },
  );
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
  await unsafePushTables(stack.db, { configValuesTable });
  await seedNotificationTemplates(stack.db, stack.registry);
  plugin = selectRendererPlugin(collectRendererPlugins(stack.registry), "mail");
});

afterAll(async () => {
  await stack.cleanup();
});

function rendererContextFor(tenantId: TenantId): RendererContext {
  const systemUser = createSystemUser(tenantId);
  const config = createConfigAccessorFactory(
    stack.registry,
    resolver,
  )({
    user: { id: systemUser.id, tenantId },
    db: createTenantDb({ db: stack.db, tenantId, mode: "tenant" }),
  });
  return { db: stack.db, registry: stack.registry, tenantId, config };
}

async function renderButtonMail(tenantId: TenantId): Promise<string> {
  const result = await plugin.render(
    {
      kind: "mail",
      payload: {
        slug: SLUG,
        locale: "de",
        variables: { url: "https://demo.example/go" },
        draft: { content: BUTTON_BODY, meta: { subject: "Hinweis" } },
      },
    },
    rendererContextFor(tenantId),
  );
  if (result.kind !== "mail") throw new Error(`unexpected render kind ${result.kind}`);
  return result.html;
}

async function readChrome(tenantId: TenantId) {
  if (plugin.readMailChrome === undefined) throw new Error("mail plugin has no readMailChrome");
  return plugin.readMailChrome({ locale: "de" }, rendererContextFor(tenantId));
}

describe("renderer-mail-html :: platform brand", () => {
  test("a system tenant mail without stored branding carries the platform title and accent in tile and button", async () => {
    const html = await renderButtonMail(SYSTEM_TENANT_ID);
    expect(html).toContain(`>${PLATFORM_TITLE}</span>`);
    expect(html).toContain(`background:${PLATFORM_ACCENT};color:#ffffff`);
    expect(html).toContain(">P</span>");
    expect(html).toMatch(new RegExp(`background-color:${PLATFORM_ACCENT};color:#ffffff[^>]*>Los`));

    const chrome = await readChrome(SYSTEM_TENANT_ID);
    expect(chrome.tenantName).toBe(PLATFORM_TITLE);
    expect(chrome.accentColor).toBe(PLATFORM_ACCENT);
  });

  test("an ordinary tenant's mail never gets the platform brand", async () => {
    const html = await renderButtonMail(ordinaryTenant);
    expect(html).not.toContain(PLATFORM_TITLE);
    expect(html).not.toContain(PLATFORM_ACCENT);

    const chrome = await readChrome(ordinaryTenant);
    expect(chrome.tenantName).not.toBe(PLATFORM_TITLE);
    expect(chrome.accentColor).toBeUndefined();
  });

  test("branding stored for the system tenant wins over the platform brand", async () => {
    const storedBranding = [
      [BRANDING_QN.title, STORED_TITLE],
      [BRANDING_QN.accentColor, STORED_ACCENT],
    ] as const;
    for (const [key, value] of storedBranding) {
      await stack.http.writeOk(
        "config:write:set",
        { key, value, scope: "tenant" },
        systemTenantAdmin,
      );
    }
    try {
      const html = await renderButtonMail(SYSTEM_TENANT_ID);
      expect(html).toContain(`>${STORED_TITLE}</span>`);
      expect(html).toContain(`background:${STORED_ACCENT};color:#ffffff`);
      expect(html).not.toContain(PLATFORM_TITLE);
      expect(html).not.toContain(PLATFORM_ACCENT);

      const chrome = await readChrome(SYSTEM_TENANT_ID);
      expect(chrome.tenantName).toBe(STORED_TITLE);
      expect(chrome.accentColor).toBe(STORED_ACCENT);
    } finally {
      for (const [key] of storedBranding) {
        await stack.http.writeOk("config:write:reset", { key, scope: "tenant" }, systemTenantAdmin);
      }
    }
  });
});
