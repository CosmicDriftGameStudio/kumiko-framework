// Preview and test mail run the real write gates and the real mail renderer; nothing is stored.
// The stack mirrors a production mail setup: delivery + channel-email with an in-memory transport.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  buildMultipartBody,
  expectErrorIncludes,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { SYSTEM_TENANT_ID } from "../constants.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.ts";
import { seedNotificationTemplates } from "../seeding.ts";
import { templateResourceEntity, templateResourcesTable } from "../table.ts";

const LOCALE = "de";
const SLUG = "inv-mailer:notify:invoice";
const emailTransport = createInMemoryTransport();
const addressOf = (userId: string): string => `${userId}@preview.test`;

const invMailer = defineFeature("inv-mailer", (r) => {
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
      invoiceNumber: templateVariable.text({ required: true, example: "RE-2026-001" }),
      headline: templateVariable.text({ example: "inv-mailer:mail.example.headline" }),
      dueDate: templateVariable.date({ example: "2026-03-15" }),
      total: templateVariable.money({ example: { amount: 11900, currency: "EUR" } }),
      positions: templateVariable.list(
        { label: templateVariable.text(), price: templateVariable.money() },
        {
          example: [
            { label: "Beratung", price: 10000 },
            { label: "Lizenz", price: 1900 },
            { label: "Dritte Zeile", price: 1 },
          ],
        },
      ),
    },
    template: {
      de: {
        body: [
          '<p>Rechnung <span data-variable="invoiceNumber"></span>, fällig <span data-variable="dueDate"></span></p>',
          '<p>Summe <span data-variable="total"></span></p>',
          '<table><tbody><tr data-each="positions"><td><p><span data-variable="label"></span></p></td><td><p><span data-variable="price"></span></p></td></tr></tbody></table>',
        ].join(""),
      },
    },
    meta: { de: { subject: "Rechnung {{invoiceNumber}}" } },
  });
  r.translations({
    keys: {
      "inv-mailer:mail.example.headline": { de: "Neue Rechnung", en: "New invoice" },
    },
  });
});

const adminOf = (id: number) =>
  createTestUser({ id, roles: ["TenantAdmin"], tenantId: testTenantId(id) });

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    files: { storageProvider: createInMemoryFileProvider() },
    features: [
      createFilesFeature(),
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async (userId) => addressOf(userId),
      }),
      invMailer,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    deliveryAttemptsTable,
  });
  await seedNotificationTemplates(stack.db, stack.registry);
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: "default",
      kind: "mail-layout",
      locale: LOCALE,
      content:
        "<mjml><mj-body><mj-section><mj-column><mj-text>SYSTEM_LAYOUT_MARKER</mj-text><mj-raw>{{{content}}}</mj-raw></mj-column></mj-section></mj-body></mjml>",
      contentFormat: "mjml",
      meta: {},
      variableSchema: {},
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: "contract-frame",
      kind: "pdf-layout",
      locale: LOCALE,
      content:
        "<div data-header><p>PDF_HEADER</p></div><div data-content></div><div data-footer><p>PDF_FOOTER</p></div>",
      contentFormat: "html",
      variableSchema: {},
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  emailTransport.sent.length = 0;
  await stack.redis.flushNamespace();
});

type Check = { code: string; ok: boolean; params?: { missing?: string[] } };
type Preview = {
  kind: string;
  subject: string | null;
  html: string;
  text: string | null;
  checks: Check[];
  layout: { slug: string; scope: string; regions: { header: string; footer: string } } | null;
};

const checkOf = (preview: Preview, code: string): Check | undefined =>
  preview.checks.find((check) => check.code === code);

const mailDraft = (content: string, extra: Record<string, unknown> = {}) => ({
  slug: SLUG,
  kind: "mail" as const,
  locale: LOCALE,
  content,
  meta: { subject: "Entwurf {{invoiceNumber}}" },
  ...extra,
});

describe("template-resolver :: preview query", () => {
  test("a stored system-only template renders with sample values and three list rows", async () => {
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE },
      adminOf(21),
    );
    expect(preview.subject).toBe("Rechnung RE-2026-001");
    expect(preview.html).toContain("RE-2026-001");
    expect(preview.html).toContain("15. März 2026");
    expect(preview.html).toContain("Beratung");
    expect(preview.html).toContain("Lizenz");
    expect(preview.html).toContain("Dritte Zeile");
    expect(preview.checks.every((check) => check.ok)).toBe(true);
  });

  test("a text example given as i18n key fills the preview in the language of the edited tab", async () => {
    const draft = (locale: string) =>
      mailDraft('<p><span data-variable="headline"></span></p>', {
        locale,
        meta: { subject: "{{headline}} {{invoiceNumber}}" },
      });
    const de = await stack.http.queryOk<Preview & { sampleValues: Record<string, unknown> }>(
      TemplateResolverQueries.preview,
      draft("de"),
      adminOf(28),
    );
    expect(de.subject).toBe("Neue Rechnung RE-2026-001");
    expect(de.html).toContain("Neue Rechnung");
    expect(de.sampleValues["headline"]).toBe("Neue Rechnung");

    const en = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      draft("en"),
      adminOf(28),
    );
    expect(en.subject).toBe("New invoice RE-2026-001");
  });

  test("a draft body replaces the stored one and nothing is saved", async () => {
    const admin = adminOf(22);
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      mailDraft('<p>ENTWURF <span data-variable="invoiceNumber"></span></p>'),
      admin,
    );
    expect(preview.subject).toBe("Entwurf RE-2026-001");
    expect(preview.html).toContain("ENTWURF RE-2026-001");
    expect(preview.html).not.toContain("Beratung");

    const stored = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE },
      admin,
    );
    expect(stored.html).toContain("Beratung");
  });

  test("a script element in the draft is a validation error", async () => {
    const err = await stack.http.queryErr(
      TemplateResolverQueries.preview,
      mailDraft('<p><span data-variable="invoiceNumber"></span></p><script>alert(1)</script>'),
      adminOf(23),
    );
    expect(err.code).toBe("validation_error");
  });

  test("an image without a linked resource fails the resources check", async () => {
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      mailDraft(
        '<p><span data-variable="invoiceNumber"></span></p><img data-resource="missing-logo">',
      ),
      adminOf(24),
    );
    const check = checkOf(preview, "resources_resolved");
    expect(check?.ok).toBe(false);
    expect(check?.params?.missing).toEqual(["missing-logo"]);
  });

  test("a draft without the required placeholder fails the required check", async () => {
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      mailDraft("<p>ohne Nummer</p>", { meta: { subject: "Ohne" } }),
      adminOf(25),
    );
    const check = checkOf(preview, "required_placeholders");
    expect(check?.ok).toBe(false);
    expect(check?.params?.missing).toEqual(["invoiceNumber"]);
  });

  test("a stored tenant layout that fails the sanitizer renders with the system layout", async () => {
    const owner = testTenantId(26);
    const executor = createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
      entityName: "template-resource",
    });
    // Seeded past the write gate, like a row that predates the current layout rules.
    const created = await executor.create(
      {
        tenantId: owner,
        slug: "default",
        kind: "mail-layout",
        locale: LOCALE,
        content:
          '<div data-header><a href="javascript:alert(1)">x</a></div><div data-content></div><div data-footer><p>TENANT_FOOTER_MARKER</p></div>',
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: "{}",
        scope: "tenant",
        parentTemplateId: null,
        status: "active",
      },
      adminOf(26),
      createTenantDb({ db: stack.db, tenantId: owner, mode: "system" }),
    );
    expect(created.isSuccess).toBe(true);
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE },
      adminOf(26),
    );
    expect(preview.html).toContain("SYSTEM_LAYOUT_MARKER");
    expect(preview.html).not.toContain("TENANT_FOOTER_MARKER");
    expect(preview.html).not.toContain("javascript:");
  });

  test("a document-pdf draft returns its body and the layout regions", async () => {
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      {
        slug: "contract",
        kind: "document-pdf",
        locale: LOCALE,
        content: "<p>Vertragstext</p>",
        meta: { layoutSlug: "contract-frame" },
      },
      adminOf(27),
    );
    expect(preview.kind).toBe("document-pdf");
    expect(preview.html).toContain("Vertragstext");
    expect(preview.subject).toBeNull();
    expect(preview.layout?.slug).toBe("contract-frame");
    expect(preview.layout?.regions.header).toContain("PDF_HEADER");
    expect(preview.layout?.regions.footer).toContain("PDF_FOOTER");
  });

  test("variables override the sample values and the rest keep their examples", async () => {
    const preview = await stack.http.queryOk<Preview & { sampleValues: Record<string, unknown> }>(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE, variables: { invoiceNumber: "RE-OVERRIDE-7" } },
      adminOf(61),
    );
    expect(preview.subject).toBe("Rechnung RE-OVERRIDE-7");
    expect(preview.html).toContain("RE-OVERRIDE-7");
    expect(preview.html).toContain("15. März 2026");
    expect(preview.html).toContain("Beratung");
    expect(preview.sampleValues["invoiceNumber"]).toBe("RE-OVERRIDE-7");
    expect(preview.sampleValues["dueDate"]).toBe("2026-03-15");
  });

  test("a text override is escaped in the html", async () => {
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      {
        slug: SLUG,
        kind: "mail",
        locale: LOCALE,
        variables: { invoiceNumber: "<script>alert(1)</script>" },
      },
      adminOf(62),
    );
    expect(preview.html).not.toContain("<script>alert(1)");
    expect(preview.html).toContain("&lt;script&gt;");
  });

  test("an override that breaks the variable schema is a validation error on variables.<name>", async () => {
    const admin = adminOf(63);
    const money = await stack.http.queryErr(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE, variables: { total: "viel" } },
      admin,
    );
    expect(money.code).toBe("validation_error");
    expectErrorIncludes(money, "variables.total");
    const date = await stack.http.queryErr(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE, variables: { dueDate: "morgen" } },
      admin,
    );
    expect(date.code).toBe("validation_error");
    expectErrorIncludes(date, "variables.dueDate");
  });

  test("an override for an undeclared variable is rejected", async () => {
    const err = await stack.http.queryErr(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE, variables: { nope: "x" } },
      adminOf(64),
    );
    expect(err.code).toBe("validation_error");
  });

  test("the role User is refused", async () => {
    const user = createTestUser({ id: 28, roles: ["User"], tenantId: testTenantId(28) });
    const res = await stack.http.query(
      TemplateResolverQueries.preview,
      { slug: SLUG, kind: "mail", locale: LOCALE },
      user,
    );
    expect(res.status).toBe(403);
  });
});

describe("template-resolver :: send-test write", () => {
  test("mails the rendered draft to the caller's own address with the test prefix", async () => {
    const admin = adminOf(31);
    const result = await stack.http.writeOk<{ subject: string; checks: Check[] }>(
      TemplateResolverHandlers.sendTest,
      mailDraft('<p>ENTWURF <span data-variable="invoiceNumber"></span></p>'),
      admin,
    );
    expect(result.subject).toBe("[TEST] Entwurf RE-2026-001");
    expect(emailTransport.sent).toHaveLength(1);
    const [message] = emailTransport.sent;
    expect(message?.to).toBe(addressOf(admin.id));
    expect(message?.subject).toBe("[TEST] Entwurf RE-2026-001");
    expect(message?.html).toContain("ENTWURF RE-2026-001");
  });

  test("variables override the sample values in the sent test mail", async () => {
    const result = await stack.http.writeOk<{ subject: string }>(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE, variables: { invoiceNumber: "RE-OVERRIDE-9" } },
      adminOf(65),
    );
    expect(result.subject).toBe("[TEST] Rechnung RE-OVERRIDE-9");
    expect(emailTransport.sent[0]?.html).toContain("RE-OVERRIDE-9");
  });

  test("an invalid override sends no test mail", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE, variables: { total: "viel" } },
      adminOf(66),
    );
    expect(err.code).toBe("validation_error");
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("a test mail fills a translated text example in the language of the edited tab", async () => {
    const result = await stack.http.writeOk<{ subject: string }>(
      TemplateResolverHandlers.sendTest,
      mailDraft('<p><span data-variable="headline"></span></p>', {
        meta: { subject: "{{headline}} {{invoiceNumber}}" },
      }),
      adminOf(36),
    );
    expect(result.subject).toBe("[TEST] Neue Rechnung RE-2026-001");
    expect(emailTransport.sent[0]?.html).toContain("Neue Rechnung");
  });

  test("prefixSubject false sends the subject without the test prefix", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE, prefixSubject: false },
      adminOf(59),
    );
    expect(emailTransport.sent[0]?.subject).toBe("Rechnung RE-2026-001");
  });

  test("an extra recipient field in the payload changes nothing", async () => {
    const admin = adminOf(32);
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      mailDraft('<p><span data-variable="invoiceNumber"></span></p>', { to: "x@evil.test" }),
      admin,
    );
    expect(emailTransport.sent.map((message) => message.to)).toEqual([addressOf(admin.id)]);
  });

  test("a stored system-only template can be test-mailed without content", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE },
      adminOf(33),
    );
    expect(emailTransport.sent).toHaveLength(1);
    expect(emailTransport.sent[0]?.subject).toBe("[TEST] Rechnung RE-2026-001");
  });

  test("a draft failing the write rules sends nothing", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.sendTest,
      mailDraft("<p>x</p><script>alert(1)</script>"),
      adminOf(34),
    );
    expect(err.code).toBe("validation_error");
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("the 11th test mail within the hour is rate limited", async () => {
    const admin = adminOf(35);
    for (let i = 0; i < 10; i++) {
      const res = await stack.http.write(
        TemplateResolverHandlers.sendTest,
        { slug: SLUG, locale: LOCALE },
        admin,
      );
      expect(res.status).toBe(200);
    }
    const blocked = await stack.http.write(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE },
      admin,
    );
    expect(blocked.status).toBe(429);
    expect(emailTransport.sent).toHaveLength(10);
  });

  test("a failing transport returns template_test_mail_failed without leaking the cause", async () => {
    emailTransport.failNext = { message: "smtp refused user@secret.test" };
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE },
      adminOf(37),
    );
    expectErrorIncludes(err, "template_test_mail_failed");
    expectErrorIncludes(err, "channel_error");
    expect(JSON.stringify(err)).not.toContain("secret.test");
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("the role User is refused", async () => {
    const user = createTestUser({ id: 36, roles: ["User"], tenantId: testTenantId(36) });
    const res = await stack.http.write(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE },
      user,
    );
    expect(res.status).toBe(403);
    expect(emailTransport.sent).toHaveLength(0);
  });
});

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n");

async function uploadFile(
  as: ReturnType<typeof adminOf>,
  bytes: Uint8Array,
  file: { name: string; type: string },
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(bytes)], file.name, { type: file.type }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("template-resolver :: preview with a logo and a file attachment", () => {
  async function storeTemplateWithResources(
    admin: ReturnType<typeof adminOf>,
    status: "active" | "draft" = "active",
  ) {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: SLUG,
        kind: "mail",
        locale: LOCALE,
        content:
          '<p><img data-resource="logo" alt="Logo"></p><p>Rechnung <span data-variable="invoiceNumber"></span></p>',
        contentFormat: "html",
        meta: { subject: "Rechnung {{invoiceNumber}}" },
        variableSchema: {},
        status,
      },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId: await uploadFile(admin, Buffer.from(PNG_BASE64, "base64"), {
          name: "logo.png",
          type: "image/png",
        }),
        templateId: created.id,
        key: "logo",
      },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId: await uploadFile(admin, PDF_BYTES, {
          name: "offer.pdf",
          type: "application/pdf",
        }),
        templateId: created.id,
        key: "offer",
        purpose: "attachment",
        fileName: "offer.pdf",
      },
      admin,
    );
  }

  test("displayHtml shows the logo as a data URI while html keeps the cid", async () => {
    const admin = adminOf(41);
    await storeTemplateWithResources(admin);
    const preview = await stack.http.queryOk<
      Preview & {
        displayHtml: string;
        attachments: Array<{ kind: string; name: string; sizeBytes: number }>;
      }
    >(TemplateResolverQueries.preview, { slug: SLUG, kind: "mail", locale: LOCALE }, admin);
    expect(preview.html).toContain("cid:logo");
    expect(preview.displayHtml).toContain("data:image/");
    expect(preview.displayHtml).not.toContain("cid:logo");
    expect(preview.attachments).toContainEqual({
      kind: "file",
      name: "offer.pdf",
      sizeBytes: PDF_BYTES.length,
    });
    expect(preview.attachments).toContainEqual(
      expect.objectContaining({ kind: "inline", name: "logo" }),
    );
  });

  test("a test mail carries the file attachment bytes", async () => {
    const admin = adminOf(42);
    await storeTemplateWithResources(admin);
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { slug: SLUG, locale: LOCALE },
      admin,
    );
    const file = emailTransport.sent[0]?.attachments?.find((a) => a.kind === "file");
    expect(file).toMatchObject({ kind: "file", fileName: "offer.pdf" });
    expect(Buffer.from(file?.content ?? [])).toEqual(Buffer.from(PDF_BYTES));
  });

  const DRAFT_BODY =
    '<p><img data-resource="logo" alt="Logo"></p><p>ENTWURF <span data-variable="invoiceNumber"></span></p>';

  test("a draft row's logo and attachment show in the preview of the edited content", async () => {
    const admin = adminOf(43);
    await storeTemplateWithResources(admin, "draft");
    const preview = await stack.http.queryOk<
      Preview & {
        displayHtml: string;
        attachments: Array<{ kind: string; name: string; sizeBytes: number }>;
      }
    >(TemplateResolverQueries.preview, mailDraft(DRAFT_BODY), admin);
    expect(preview.html).toContain("cid:logo");
    expect(preview.displayHtml).toContain("data:image/");
    expect(preview.attachments).toContainEqual({
      kind: "file",
      name: "offer.pdf",
      sizeBytes: PDF_BYTES.length,
    });
    expect(checkOf(preview, "resources_resolved")?.ok).toBe(true);
  });

  test("a test mail of the edited content carries the draft row's attachment", async () => {
    const admin = adminOf(44);
    await storeTemplateWithResources(admin, "draft");
    await stack.http.writeOk(TemplateResolverHandlers.sendTest, mailDraft(DRAFT_BODY), admin);
    const file = emailTransport.sent[0]?.attachments?.find((a) => a.kind === "file");
    expect(file).toMatchObject({ kind: "file", fileName: "offer.pdf" });
    expect(Buffer.from(file?.content ?? [])).toEqual(Buffer.from(PDF_BYTES));
    expect(emailTransport.sent[0]?.attachments?.some((a) => a.kind === "inline")).toBe(true);
  });

  test("includeAttachments=false drops the files but keeps the inline images", async () => {
    const admin = adminOf(61);
    await storeTemplateWithResources(admin, "draft");
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { ...mailDraft(DRAFT_BODY), includeAttachments: false },
      admin,
    );
    const attachments = emailTransport.sent[0]?.attachments ?? [];
    expect(attachments.some((a) => a.kind === "file")).toBe(false);
    expect(attachments.some((a) => a.kind === "inline")).toBe(true);
  });

  test("includeAttachments=true sends the files like the default", async () => {
    const admin = adminOf(62);
    await storeTemplateWithResources(admin, "draft");
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { ...mailDraft(DRAFT_BODY), includeAttachments: true },
      admin,
    );
    expect(emailTransport.sent[0]?.attachments?.some((a) => a.kind === "file")).toBe(true);
  });

  test("a test mail carries the template's sender name and reply-to", async () => {
    const admin = adminOf(63);
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      mailDraft("<p>x</p>", {
        meta: {
          subject: "Entwurf",
          senderName: "Nordlicht Immobilien GmbH",
          replyTo: "buchhaltung@nordlicht-immobilien.de",
        },
      }),
      admin,
    );
    expect(emailTransport.sent[0]).toMatchObject({
      fromName: "Nordlicht Immobilien GmbH",
      replyTo: "buchhaltung@nordlicht-immobilien.de",
    });
  });

  test("a reply-to that is not an email address is rejected", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.sendTest,
      mailDraft("<p>x</p>", { meta: { subject: "Entwurf", replyTo: "not-an-address" } }),
      adminOf(64),
    );
    expect(err.code).toBe("validation_error");
  });

  test("the resources of another tenant's row are not used", async () => {
    await storeTemplateWithResources(adminOf(45), "draft");
    const preview = await stack.http.queryOk<Preview & { attachments: unknown[] }>(
      TemplateResolverQueries.preview,
      mailDraft(DRAFT_BODY),
      adminOf(46),
    );
    expect(preview.attachments).toEqual([]);
    expect(checkOf(preview, "resources_resolved")?.ok).toBe(false);
  });
});

describe("template-resolver :: preview with a linked PDF template", () => {
  test("lists the PDF under its rendered name without rendering it", async () => {
    const admin = adminOf(47);
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      {
        slug: "inv-mailer:doc:invoice",
        kind: "document-pdf",
        locale: LOCALE,
        content: "<p>Rechnung</p>",
        contentFormat: "html",
        meta: {},
        variableSchema: {},
      },
      TestUsers.systemAdmin,
    );
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: SLUG,
        kind: "mail",
        locale: LOCALE,
        content: '<p>Rechnung <span data-variable="invoiceNumber"></span></p>',
        contentFormat: "html",
        meta: { subject: "Rechnung {{invoiceNumber}}" },
        variableSchema: {},
        status: "draft",
      },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceLinkPdf,
      {
        templateId: created.id,
        key: "invoice",
        templateSlug: "inv-mailer:doc:invoice",
        fileName: "rechnung-{{invoiceNumber}}.pdf",
      },
      admin,
    );
    const preview = await stack.http.queryOk<
      Preview & { attachments: Array<Record<string, unknown>> }
    >(
      TemplateResolverQueries.preview,
      mailDraft('<p>Rechnung <span data-variable="invoiceNumber"></span></p>'),
      admin,
    );
    expect(preview.attachments).toEqual([
      {
        kind: "rendered-pdf",
        name: "rechnung-RE-2026-001.pdf",
        templateSlug: "inv-mailer:doc:invoice",
      },
    ]);
    expect(checkOf(preview, "size_under_cap")?.ok).toBe(true);
  });
});

describe("template-resolver :: preview resources of an edited row without resources", () => {
  const FALLBACK_SLUG = "preview:system-logo-only";
  const LOGO_BODY = '<p><img data-resource="logo" alt="Logo"></p><p>Hallo</p>';
  const draftOf = (content: string) => ({
    slug: FALLBACK_SLUG,
    kind: "mail" as const,
    locale: LOCALE,
    content,
    meta: { subject: "Hallo" },
  });

  beforeAll(async () => {
    const systemRow = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      {
        slug: FALLBACK_SLUG,
        kind: "mail",
        locale: LOCALE,
        content: LOGO_BODY,
        contentFormat: "html",
        meta: { subject: "Hallo" },
        variableSchema: {},
      },
      TestUsers.systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId: await uploadFile(
          TestUsers.systemAdmin,
          Buffer.from(PNG_BASE64, "base64"),
          { name: "logo.png", type: "image/png" },
        ),
        templateId: systemRow.id,
        key: "logo",
        tenantIdOverride: SYSTEM_TENANT_ID,
      },
      TestUsers.systemAdmin,
    );
  });

  test("without a tenant row the system template's logo resolves", async () => {
    const preview = await stack.http.queryOk<Preview>(
      TemplateResolverQueries.preview,
      draftOf(LOGO_BODY),
      adminOf(48),
    );
    expect(preview.html).toContain("cid:logo");
    expect(checkOf(preview, "resources_resolved")?.ok).toBe(true);
  });

  test("a tenant draft without resources does not borrow the system logo", async () => {
    const admin = adminOf(49);
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: FALLBACK_SLUG,
        kind: "mail",
        locale: LOCALE,
        content: "<p>Hallo</p>",
        contentFormat: "html",
        meta: { subject: "Hallo" },
        variableSchema: {},
        status: "draft",
      },
      admin,
    );
    const preview = await stack.http.queryOk<Preview & { attachments: unknown[] }>(
      TemplateResolverQueries.preview,
      draftOf(LOGO_BODY),
      admin,
    );
    expect(preview.html).not.toContain("cid:logo");
    expect(preview.attachments).toEqual([]);
    expect(checkOf(preview, "resources_resolved")?.ok).toBe(false);
  });
});
