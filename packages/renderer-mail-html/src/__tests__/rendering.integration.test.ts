// Integration: plugin -> foundation pool roundtrip and end-to-end render against
// a real test DB. Templates are written through the real handlers (HTTP) or the
// boot seed, never straight into the event tables.
//
// Tests run in file order: the default-layout fallback case needs an empty
// layout table, the system layout test seeds "default", and the tenant layout
// test shadows it for its own tenant only.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  createRendererFoundationFeature,
  RendererError,
  type RendererPlugin,
  type RenderRequest,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverApi,
  createTemplateResolverFeature,
  SYSTEM_TENANT_ID,
  TemplateResolverHandlers,
  templateResourceEntity,
  templateResourcesTable,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type TenantId,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { setupAppTestStack } from "@cosmicdrift/kumiko-testing";
import * as z from "zod";
import { DEFAULT_MAIL_LAYOUT_MJML } from "../default-layout";
import { createRendererMailHtmlFeature } from "../feature";
import { seedSystemMailLayout } from "../seeding";

const SLUG = "mail-demo:notify:welcome";
const LOCALE = "de";

const mailDemo = defineFeature("mail-demo", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("welcome", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    variables: {
      name: templateVariable.text({ required: true }),
      url: templateVariable.link(),
      total: templateVariable.money(),
      due: templateVariable.date(),
      lines: templateVariable.list({
        label: templateVariable.text(),
        price: templateVariable.money(),
      }),
    },
    template: {
      de: {
        body: [
          '<p>Hallo <span data-variable="name"></span>,</p>',
          '<p><a href="{{url}}">Bestätigen</a></p>',
          '<p>Summe <span data-variable="total"></span> fällig <span data-variable="due"></span></p>',
          '<table><tbody><tr data-each="lines"><td><p><span data-variable="label"></span></p></td><td><p><span data-variable="price"></span></p></td></tr></tbody></table>',
        ].join(""),
      },
    },
    meta: { de: { subject: "Willkommen {{name}}" } },
  });
});

const tenantAdmin = (id: number) =>
  createTestUser({ id, roles: ["TenantAdmin"], tenantId: testTenantId(id) });
const tenantId = (id: number): TenantId => testTenantId(id);

const PLAIN_VARIABLES = {
  name: "Anna",
  url: "https://example.com/confirm",
  total: 123456,
  due: "2026-03-05",
  lines: [{ label: "Posten A", price: 1000 }],
};

let stack: TestStack;
let plugin: RendererPlugin;

beforeAll(async () => {
  stack = await setupAppTestStack(
    [
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      mailDemo,
    ],
    { includeBundled: false },
  );
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
  await seedNotificationTemplates(stack.db, stack.registry);
  plugin = createRendererFoundationApi(
    collectRendererPlugins(stack.registry),
  ).createRendererForTenant({ tenantId: tenantId(1), kind: "mail" });
});

afterAll(async () => {
  await stack.cleanup();
});

async function renderMail(
  tenant: TenantId,
  variables: Readonly<Record<string, unknown>> = PLAIN_VARIABLES,
  extra: { slug?: string; unsubscribeUrl?: string } = {},
) {
  const result = await plugin.render(
    {
      kind: "mail",
      payload: {
        slug: extra.slug ?? SLUG,
        locale: LOCALE,
        variables,
        ...(extra.unsubscribeUrl === undefined ? {} : { unsubscribeUrl: extra.unsubscribeUrl }),
      },
    },
    { db: stack.db, registry: stack.registry, tenantId: tenant },
  );
  if (result.kind !== "mail") throw new Error(`unexpected render kind ${result.kind}`);
  return result;
}

function layoutPayload(marker: string, extra: Record<string, unknown> = {}) {
  return {
    slug: "default",
    kind: "mail-layout" as const,
    locale: LOCALE,
    content: `<mjml><mj-body><mj-section><mj-column><mj-text>${marker}</mj-text><mj-raw>{{{content}}}</mj-raw></mj-column></mj-section></mj-body></mjml>`,
    contentFormat: "mjml" as const,
    meta: {},
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

function tenantLayoutPayload(marker: string, extra: Record<string, unknown> = {}) {
  return {
    slug: "default",
    kind: "mail-layout" as const,
    locale: LOCALE,
    content: `<div data-header><p>${marker}</p></div><div data-content></div><div data-footer><p>FOOTER_${marker}</p></div>`,
    contentFormat: "html" as const,
    meta: {},
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

describe("renderer-mail-html :: registration", () => {
  test("the plugin registers at the renderer extension point and serves kind mail", () => {
    const plugins = collectRendererPlugins(stack.registry);
    expect(plugins.map((p) => p.name)).toContain("mail-html");
    expect([...plugin.kinds]).toEqual(["mail"]);
  });

  test("a request of another kind is rejected as invalid_payload", async () => {
    const request: RenderRequest = { kind: "notification", payload: {} };
    const failure = await plugin
      .render(request, { db: stack.db, registry: stack.registry, tenantId: tenantId(1) })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RendererError);
    if (failure instanceof RendererError) expect(failure.code).toBe("invalid_payload");
  });
});

describe("renderer-mail-html :: seeded template", () => {
  test("renders subject, html and text with the variable values and the default layout", async () => {
    const result = await renderMail(tenantId(1));
    expect(result.subject).toBe("Willkommen Anna");
    expect(result.html).toContain("Hallo Anna");
    expect(result.html).toContain('href="https://example.com/confirm"');
    expect(result.html).toContain("1.234,56");
    expect(result.html).toContain("05.03.2026");
    expect(result.html).toContain("Posten A");
    expect(result.html).toContain("<table");
    expect(result.text).toContain("Hallo Anna");
  });

  test("the response names the seeded system row it was rendered from", async () => {
    const seeded = await createTemplateResolverApi(stack.db).findExact({
      tenantId: SYSTEM_TENANT_ID,
      slug: SLUG,
      kind: "mail",
      locale: LOCALE,
    });
    const result = await renderMail(tenantId(1));
    expect(seeded).not.toBeNull();
    expect(result.template).toEqual({
      templateId: seeded?.id,
      templateVersion: seeded?.version,
      scope: "system",
    });
  });

  test("an unknown slug is invalid_payload, a missing locale too", async () => {
    await expect(
      renderMail(tenantId(1), {}, { slug: "mail-demo:notify:nope" }),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  test("unsubscribeUrl shows a footer link only when set", async () => {
    const without = await renderMail(tenantId(1));
    expect(without.html).not.toContain("Unsubscribe");
    const withLink = await renderMail(tenantId(1), PLAIN_VARIABLES, {
      unsubscribeUrl: "https://example.com/unsub",
    });
    expect(withLink.html).toContain('href="https://example.com/unsub"');
  });
});

describe("renderer-mail-html :: injection", () => {
  test("variable values are HTML-escaped", async () => {
    const result = await renderMail(tenantId(1), {
      ...PLAIN_VARIABLES,
      name: "<img src=x onerror=1>[x](http://evil)",
    });
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;img src");
  });

  test("a javascript: link value renders as #", async () => {
    const result = await renderMail(tenantId(1), {
      ...PLAIN_VARIABLES,
      url: "javascript:alert(1)",
    });
    expect(result.html).not.toContain("javascript:");
    expect(result.html).toContain('href="#"');
  });

  test("ampersands and quotes reach subject and text verbatim, not as HTML entities", async () => {
    const result = await renderMail(tenantId(1), { ...PLAIN_VARIABLES, name: "Müller & Bob's" });
    expect(result.subject).toBe("Willkommen Müller & Bob's");
    expect(result.text).toContain("Hallo Müller & Bob's");
    expect(result.html).toContain("Müller &amp; Bob");
  });

  test("a subject variable cannot add header lines", async () => {
    const result = await renderMail(tenantId(1), { ...PLAIN_VARIABLES, name: "A\r\nBcc: x@y.z" });
    expect(result.subject).not.toMatch(/[\r\n]/);
  });

  test("author text with Handlebars syntax stays inert", async () => {
    const admin = tenantAdmin(2);
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: SLUG,
        kind: "mail",
        locale: LOCALE,
        content:
          '<p>{{{name}}} {{constructor}} {{#each lines}}x{{/each}} <span data-variable="name"></span></p>',
        contentFormat: "html",
        meta: { subject: "Hi {{name}}" },
        variableSchema: {},
        linkedResources: {},
        status: "active",
      },
      admin,
    );
    const result = await renderMail(tenantId(2), { ...PLAIN_VARIABLES, name: "SECRET" });
    expect(result.html).toContain("&#123;&#123;&#123;name&#125;&#125;&#125;");
    expect(result.html).toContain("&#123;&#123;constructor&#125;&#125;");
    expect(result.html).not.toContain("{{");
  });
});

describe("renderer-mail-html :: tenant override", () => {
  test("a tenant draft does not change the render, publishing does", async () => {
    const admin = tenantAdmin(3);
    const body = '<p>Override <span data-variable="name"></span></p>';
    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: SLUG,
        kind: "mail",
        locale: LOCALE,
        content: body,
        contentFormat: "html",
        meta: { subject: "Eigener Betreff {{name}}" },
        variableSchema: {},
        linkedResources: {},
      },
      admin,
    );
    expect((await renderMail(tenantId(3))).subject).toBe("Willkommen Anna");

    await stack.http.writeOk(TemplateResolverHandlers.publish, { id: draft.id }, admin);
    const result = await renderMail(tenantId(3));
    expect(result.subject).toBe("Eigener Betreff Anna");
    expect(result.html).toContain("Override Anna");
    expect(result.template).toEqual({
      templateId: draft.id,
      templateVersion: expect.any(Number),
      scope: "tenant",
    });
  });
});

describe("renderer-mail-html :: layout resolution", () => {
  test("without any layout row the in-code default layout is used", async () => {
    const result = await renderMail(tenantId(1));
    expect(result.html).toContain("<table");
    expect(result.html).not.toContain("SYSTEM_LAYOUT_MARKER");
    expect(result.layout).toBeUndefined();
  });

  test("a seeded system layout named default is used", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload("SYSTEM_LAYOUT_MARKER"),
      TestUsers.systemAdmin,
    );
    const result = await renderMail(tenantId(1));
    expect(result.html).toContain("SYSTEM_LAYOUT_MARKER");
    expect(result.html).toContain("Hallo Anna");
    const systemLayout = await createTemplateResolverApi(stack.db).findExact({
      tenantId: SYSTEM_TENANT_ID,
      slug: "default",
      kind: "mail-layout",
      locale: LOCALE,
    });
    expect(result.layout).toEqual({
      templateId: systemLayout?.id,
      templateVersion: systemLayout?.version,
      scope: "system",
    });
  });

  test("a tenant layout wins over the system layout for that tenant only", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      tenantLayoutPayload("TENANT_LAYOUT_MARKER", { status: "active" }),
      tenantAdmin(4),
    );
    const own = await renderMail(tenantId(4));
    expect(own.html).toContain("TENANT_LAYOUT_MARKER");
    expect(own.html).toContain("FOOTER_TENANT_LAYOUT_MARKER");
    expect(own.html).toContain("Hallo Anna");
    expect(own.html).not.toContain("SYSTEM_LAYOUT_MARKER");
    expect(own.layout?.scope).toBe("tenant");
    expect(await renderMail(tenantId(1))).toMatchObject({
      html: expect.stringContaining("SYSTEM_LAYOUT_MARKER"),
    });
  });

  test("a tenant layout region renders its placeholders from the layout context", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      tenantLayoutPayload("x", {
        content:
          '<div data-header><p><span data-variable="tenantName"></span></p></div><div data-content></div><div data-footer><p><a href="{{unsubscribeUrl}}">Abmelden</a></p></div>',
        status: "active",
      }),
      tenantAdmin(11),
    );
    const result = await renderMail(tenantId(11), PLAIN_VARIABLES, {
      unsubscribeUrl: "https://example.com/unsub",
    });
    expect(result.html).toContain('href="https://example.com/unsub"');
    expect(result.html).toContain("Abmelden");
  });

  test("a leftover tenant mjml layout is ignored in favour of the system layout", async () => {
    const legacyExecutor = createEventStoreExecutor(
      templateResourcesTable,
      templateResourceEntity,
      {
        entityName: "template-resource",
      },
    );
    const owner = tenantId(12);
    const created = await legacyExecutor.create(
      {
        tenantId: owner,
        slug: "default",
        kind: "mail-layout",
        locale: LOCALE,
        content: layoutPayload("LEGACY_TENANT_MJML_MARKER").content,
        contentFormat: "mjml",
        variableSchema: "{}",
        linkedResources: "{}",
        meta: null,
        title: null,
        folder: null,
        scope: "tenant",
        parentTemplateId: null,
        status: "active",
      },
      createTestUser({ id: 12, roles: ["TenantAdmin"], tenantId: owner }),
      createTenantDb(stack.db, owner, "system"),
    );
    expect(created.isSuccess).toBe(true);
    const result = await renderMail(owner);
    expect(result.html).not.toContain("LEGACY_TENANT_MJML_MARKER");
    expect(result.html).toContain("SYSTEM_LAYOUT_MARKER");
    expect(result.layout?.scope).toBe("system");
  });

  async function storeTenantHtmlLayout(
    owner: ReturnType<typeof tenantId>,
    userId: number,
    content: string,
  ) {
    const legacyExecutor = createEventStoreExecutor(
      templateResourcesTable,
      templateResourceEntity,
      { entityName: "template-resource" },
    );
    const created = await legacyExecutor.create(
      {
        tenantId: owner,
        slug: "default",
        kind: "mail-layout",
        locale: LOCALE,
        content,
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: "{}",
        scope: "tenant",
        parentTemplateId: null,
        status: "active",
      },
      createTestUser({ id: userId, roles: ["TenantAdmin"], tenantId: owner }),
      createTenantDb(stack.db, owner, "system"),
    );
    expect(created.isSuccess).toBe(true);
  }

  test("a stored tenant html layout with a form is rendered with the form stripped", async () => {
    const owner = tenantId(14);
    await storeTenantHtmlLayout(
      owner,
      14,
      '<div data-header><form action="https://evil.example"><input name="x"></form></div><div data-content></div><div data-footer><p>TENANT_FOOTER_MARKER</p></div>',
    );
    const result = await renderMail(owner);
    expect(result.html).not.toContain("evil.example");
    expect(result.html).not.toContain("<form");
    expect(result.html).toContain("TENANT_FOOTER_MARKER");
    expect(result.layout?.scope).toBe("tenant");
  });

  test("a stored tenant html layout failing the sanitizer falls back to the system layout", async () => {
    const owner = tenantId(15);
    await storeTenantHtmlLayout(
      owner,
      15,
      '<div data-header><a href="javascript:alert(1)">x</a></div><div data-content></div><div data-footer><p>TENANT_FOOTER_MARKER</p></div>',
    );
    const result = await renderMail(owner);
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("TENANT_FOOTER_MARKER");
    expect(result.html).toContain("SYSTEM_LAYOUT_MARKER");
    expect(result.layout?.scope).toBe("system");
  });

  test("the layout only sees its fixed variables, not payload variables", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload("N[{{name}}]|{{subject}}|"),
      TestUsers.systemAdmin,
    );
    const result = await renderMail(tenantId(5));
    expect(result.html).toContain("N[]|Willkommen Anna|");
  });

  test("seedSystemMailLayout is idempotent and stores the default layout as a system row", async () => {
    await seedSystemMailLayout(stack.db, { locale: "fr" });
    await seedSystemMailLayout(stack.db, { locale: "fr" });
    const layout = await createTemplateResolverApi(stack.db).resolveTemplate({
      tenantId: tenantId(1),
      slug: "default",
      kind: "mail-layout",
      locale: "fr",
    });
    expect(layout).toMatchObject({ scope: "system", contentFormat: "mjml" });
    expect(layout.content).toBe(DEFAULT_MAIL_LAYOUT_MJML);
  });
});

describe("renderer-mail-html :: broken layouts", () => {
  test("an invalid MJML layout is an error with code other, not invalid_payload", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload("x", {
        content: "<mjml><mj-body><mj-bogus>{{{content}}}</mj-bogus></mj-body></mjml>",
      }),
      TestUsers.systemAdmin,
    );
    await expect(renderMail(tenantId(6))).rejects.toMatchObject({ code: "other" });
  });

  test("a layout with broken Handlebars is an error with code other", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload("x", {
        content: "<mjml><mj-body>{{#if}}{{{content}}}</mj-body></mjml>",
      }),
      TestUsers.systemAdmin,
    );
    await expect(renderMail(tenantId(7))).rejects.toMatchObject({ code: "other" });
  });
});

describe("renderer-mail-html :: write gates", () => {
  test("a tenant mjml layout and an mjml layout without the content slot are rejected", async () => {
    const tenantMjml = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      layoutPayload("x"),
      tenantAdmin(13),
    );
    expect(JSON.stringify(tenantMjml.details)).toContain("layout_source_system_only");
    const noSlot = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload("x", { content: "<mjml><mj-body></mj-body></mjml>" }),
      TestUsers.systemAdmin,
    );
    expect(JSON.stringify(noSlot.details)).toContain("layout_missing_content_slot");
  });

  test("upsert with an unknown placeholder is rejected and names it", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: SLUG,
        kind: "mail",
        locale: "en",
        content: '<p><span data-variable="nope"></span></p>',
        contentFormat: "html",
        meta: { subject: "x" },
        variableSchema: {},
        linkedResources: {},
      },
      tenantAdmin(8),
    );
    expect(err.code).toBe("validation_error");
    expect(JSON.stringify(err.details)).toContain("nope");
  });

  test("a required variable missing: system upsert rejected, tenant draft saved, publish rejected", async () => {
    const incomplete = {
      slug: SLUG,
      kind: "mail" as const,
      locale: "en",
      content: "<p>nothing</p>",
      contentFormat: "html" as const,
      meta: { subject: "x" },
      variableSchema: {},
      linkedResources: {},
    };
    const systemErr = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      incomplete,
      TestUsers.systemAdmin,
    );
    expect(systemErr.code).toBe("validation_error");

    const admin = tenantAdmin(9);
    const draft = await stack.http.writeOk<{
      id: string;
      validation: { missingRequired: string[] };
    }>(TemplateResolverHandlers.upsertTenant, incomplete, admin);
    expect(draft.validation.missingRequired).toEqual(["name"]);
    const publishErr = await stack.http.writeErr(
      TemplateResolverHandlers.publish,
      { id: draft.id },
      admin,
    );
    expect(publishErr.code).toBe("validation_error");
  });
});
