import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  defineFeature,
  SYSTEM_TENANT_ID,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { createTemplateResolverFeature } from "../feature.js";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.js";
import { templateResourceEntity } from "../table.js";

const mailer = defineFeature("pipe-mailer", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("hello", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    variables: { name: templateVariable.text({ required: true }) },
  });
});

const SLUG = "pipe-mailer:notify:hello";
const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const systemTenantAdmin = createTestUser({
  id: 3,
  roles: ["SystemAdmin"],
  tenantId: SYSTEM_TENANT_ID,
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature(), mailer] });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

const body = '<p>Hi <span data-variable="name"></span></p>';

function mailPayload(content: string, extra: Record<string, unknown> = {}) {
  return {
    slug: SLUG,
    kind: "mail" as const,
    locale: "de",
    content,
    contentFormat: "html" as const,
    meta: { subject: "Hallo {{name}}" },
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

function layoutPayload(
  slug: string,
  kind: "mail-layout" | "pdf-layout",
  content: string,
  format = "html",
) {
  return {
    slug,
    kind,
    locale: "de",
    content,
    contentFormat: format,
    variableSchema: {},
    linkedResources: {},
  };
}

function fieldCodes(err: { details?: unknown }): string[] {
  return (err.details as { fields: Array<{ code: string }> }).fields.map((field) => field.code);
}

describe("template-resolver :: validate query", () => {
  test("reports used placeholders and a publishable draft", async () => {
    const result = await stack.http.queryOk<{
      canSave: boolean;
      canPublish: boolean;
      used: string[];
      unknown: string[];
      missingRequired: string[];
    }>(TemplateResolverQueries.validate, mailPayload(body), tenantAdmin);
    expect(result.canSave).toBe(true);
    expect(result.canPublish).toBe(true);
    expect(result.used).toEqual(["name"]);
    expect(result.unknown).toEqual([]);
  });

  test("an unknown placeholder blocks saving and is listed", async () => {
    const result = await stack.http.queryOk<{ canSave: boolean; unknown: string[] }>(
      TemplateResolverQueries.validate,
      mailPayload('<p><span data-variable="name"></span><span data-variable="nope"></span></p>'),
      tenantAdmin,
    );
    expect(result.canSave).toBe(false);
    expect(result.unknown).toEqual(["nope"]);
  });

  test("a missing required variable allows a draft but not publishing", async () => {
    const result = await stack.http.queryOk<{
      canSave: boolean;
      canPublish: boolean;
      missingRequired: string[];
    }>(TemplateResolverQueries.validate, mailPayload("<p>nothing</p>"), tenantAdmin);
    expect(result.canSave).toBe(true);
    expect(result.canPublish).toBe(false);
    expect(result.missingRequired).toEqual(["name"]);
  });

  test("a sanitizer problem blocks saving", async () => {
    const result = await stack.http.queryOk<{ canSave: boolean }>(
      TemplateResolverQueries.validate,
      mailPayload("<script>x</script>"),
      tenantAdmin,
    );
    expect(result.canSave).toBe(false);
  });
});

describe("template-resolver :: layout rules", () => {
  test("a system mail-layout in mjml needs the content slot exactly once", async () => {
    const missing = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload("layout-a", "mail-layout", "<mjml><mj-body></mj-body></mjml>", "mjml"),
      systemAdmin,
    );
    expect(fieldCodes(missing)).toContain("layout_missing_content_slot");
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload(
        "layout-a",
        "mail-layout",
        "<mjml><mj-body>{{{content}}}</mj-body></mjml>",
        "mjml",
      ),
      systemAdmin,
    );
  });

  test("a tenant cannot write an mjml mail-layout", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      layoutPayload(
        "layout-a",
        "mail-layout",
        "<mjml><mj-body>{{{content}}}</mj-body></mjml>",
        "mjml",
      ),
      tenantAdmin,
    );
    expect(fieldCodes(err)).toContain("layout_source_system_only");
  });

  test("a tenant html layout needs a data-content slot", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      layoutPayload("layout-b", "mail-layout", "<header><p>Brand</p></header>"),
      tenantAdmin,
    );
    expect(fieldCodes(err)).toContain("layout_missing_content_slot");
  });

  test("a pdf-layout without a content slot is rejected", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload("layout-c", "pdf-layout", "<p>no slot</p>"),
      systemAdmin,
    );
    expect(fieldCodes(err)).toContain("layout_missing_content_slot");
  });
});

describe("template-resolver :: copy-locale", () => {
  test("copies a system locale into a tenant draft and refuses an existing target", async () => {
    await stack.http.writeOk(TemplateResolverHandlers.upsertSystem, mailPayload(body), systemAdmin);
    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      { slug: SLUG, kind: "mail", fromLocale: "de", toLocale: "en" },
      tenantAdmin,
    );
    const again = await stack.http.writeErr(
      TemplateResolverHandlers.copyLocale,
      { slug: SLUG, kind: "mail", fromLocale: "de", toLocale: "en" },
      tenantAdmin,
    );
    expect(fieldCodes(again)).toEqual(["target_exists"]);
    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      { slug: SLUG, kind: "mail", fromLocale: "de", toLocale: "en", overwrite: true },
      tenantAdmin,
    );
  });

  test("a system mjml mail-layout cannot be copied into a tenant and leaves no tenant row", async () => {
    const slug = "layout-copy-source";
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload(slug, "mail-layout", "<mjml><mj-body>{{{content}}}</mj-body></mjml>", "mjml"),
      systemAdmin,
    );
    const copy = { slug, kind: "mail-layout", fromLocale: "de", toLocale: "en" };
    const first = await stack.http.writeErr(TemplateResolverHandlers.copyLocale, copy, tenantAdmin);
    expect(fieldCodes(first)).toEqual(["layout_source_system_only"]);
    // A leftover target row would turn the second attempt into target_exists.
    const second = await stack.http.writeErr(
      TemplateResolverHandlers.copyLocale,
      copy,
      tenantAdmin,
    );
    expect(fieldCodes(second)).toEqual(["layout_source_system_only"]);
  });

  test("a missing source is not found", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.copyLocale,
      { slug: SLUG, kind: "mail", fromLocale: "fr", toLocale: "it" },
      tenantAdmin,
    );
    expectErrorIncludes(err, "not_found");
  });
});

describe("template-resolver :: set on layout kinds", () => {
  function setLayout(slug: string, content: string) {
    return {
      slug,
      locale: "de",
      kind: "mail-layout" as const,
      title: "Layout",
      content,
      contentFormat: "html" as const,
    };
  }

  test("a tenant layout with a form or a tracking image is rejected", async () => {
    const form = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      setLayout(
        "set-layout-a",
        '<div data-header><form action="https://evil.example"><input name="x"></form></div><div data-content></div>',
      ),
      tenantAdmin,
    );
    expect(fieldCodes(form)).toContain("disallowed_link_href");
    const tracking = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      setLayout(
        "set-layout-a",
        '<div data-header><img src="https://t.example/p.gif"></div><div data-content></div>',
      ),
      tenantAdmin,
    );
    expect(fieldCodes(tracking)).toContain("external_image_source");
  });

  test("a layout without the content slot is rejected", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      setLayout("set-layout-b", "<div data-header><p>Brand</p></div>"),
      tenantAdmin,
    );
    expect(fieldCodes(err)).toContain("layout_missing_content_slot");
  });

  test("a valid layout is stored and an mjml layout from a tenant is refused", async () => {
    const stored = await stack.http.writeOk<{ isNew: boolean }>(
      TemplateResolverHandlers.set,
      setLayout("set-layout-c", "<div data-header><p>Brand</p></div><div data-content></div>"),
      tenantAdmin,
    );
    expect(stored.isNew).toBe(true);
    const mjml = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      {
        ...setLayout("set-layout-d", "<mjml><mj-body>{{{content}}}</mj-body></mjml>"),
        contentFormat: "mjml" as const,
      },
      tenantAdmin,
    );
    expect(fieldCodes(mjml)).toContain("layout_source_system_only");
  });
});

describe("template-resolver :: system tenant caller", () => {
  test("upsert-tenant is refused under the system tenant", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      mailPayload(body),
      systemTenantAdmin,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("publish and archive do not reach a system row through the tenant handlers", async () => {
    const system = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      mailPayload(body, { locale: "sv" }),
      systemAdmin,
    );
    for (const handler of [TemplateResolverHandlers.publish, TemplateResolverHandlers.archive]) {
      const err = await stack.http.writeErr(handler, { id: system.id }, systemTenantAdmin);
      expectErrorIncludes(err, "not_found");
    }
  });
});

describe("template-resolver :: document placeholders", () => {
  test("page is a system placeholder in document-pdf but unknown in mail", async () => {
    const withPage =
      '<p>Hi <span data-variable="name"></span> <span data-variable="page"></span></p>';
    const pdf = await stack.http.queryOk<{ canSave: boolean; unknown: string[] }>(
      TemplateResolverQueries.validate,
      mailPayload(withPage, { kind: "document-pdf", meta: undefined }),
      tenantAdmin,
    );
    expect(pdf.unknown).not.toContain("page");
    const mail = await stack.http.queryOk<{ unknown: string[] }>(
      TemplateResolverQueries.validate,
      mailPayload(withPage),
      tenantAdmin,
    );
    expect(mail.unknown).toContain("page");
  });
});
