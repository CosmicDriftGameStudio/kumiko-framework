// patch-draft and document-blocks run through the real write pipeline; nothing is mocked.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
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
import { createTemplateResolverFeature } from "../feature.ts";
import { seedNotificationTemplates } from "../seeding.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const TENANT_EDITABLE = tenantEditableTemplates(
  ["mail-layout", "pdf-layout", "mail"],
  ["default", "contract-frame", "patch-free", "base", "b1", "b2", "inv-mailer:notify:invoice"],
);

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
      createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }),
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

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Block = { id: string; type: string; text?: string; each?: string; resource?: string };
type Blocks = {
  base: { scope: string; version: number };
  status: string;
  blocks: Block[];
  meta: Record<string, unknown>;
  variablesDeclaredByFeature: boolean;
  allowedBlocks: string[];
  resourceKeys: string[];
};

const FREE_SLUG = "patch-free";
const FREE_BODY =
  '<p>Hallo <span data-variable="name"></span></p><p>Zweiter Absatz</p><p>Dritter Absatz</p>';

type Admin = ReturnType<typeof adminOf>;

const blocksOf = (slug: string, as: Admin) =>
  stack.http.queryOk<Blocks>(
    TemplateResolverQueries.documentBlocks,
    { slug, kind: "mail", locale: LOCALE },
    as,
  );

const patchOf = (slug: string, base: Blocks["base"], ops: unknown[], as: Admin) =>
  stack.http.write(
    TemplateResolverHandlers.patchDraft,
    { slug, kind: "mail", locale: LOCALE, base, ops },
    as,
  );

async function storeFreeTemplate(as: Admin, status: "active" | "draft" = "draft") {
  return stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertTenant,
    {
      slug: FREE_SLUG,
      kind: "mail",
      locale: LOCALE,
      content: FREE_BODY,
      contentFormat: "html",
      meta: { subject: "Hallo {{name}}" },
      variableSchema: { name: { type: "text", required: true } },
      status,
    },
    as,
  );
}

async function uploadImage(as: Admin): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append(
    "file",
    new File([Buffer.from(PNG_BASE64, "base64")], "banner.png", { type: "image/png" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("template-resolver :: document-blocks query", () => {
  test("reads a served system template as blocks with meta, variables and the system base", async () => {
    const result = await blocksOf(SLUG, adminOf(71));
    expect(result.base.scope).toBe("system");
    expect(result.status).toBe("active");
    expect(result.blocks.map((block) => block.id)).toEqual(["b0", "b1", "b2"]);
    expect(result.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(result.blocks[0]?.text).toContain("{{invoiceNumber}}");
    expect(result.blocks[2]).toMatchObject({ type: "repeat", each: "positions" });
    expect(result.meta["subject"]).toBe("Rechnung {{invoiceNumber}}");
    expect(result.variablesDeclaredByFeature).toBe(true);
    expect(result.allowedBlocks).toContain("button");
  });

  test("the role User is refused", async () => {
    const user = createTestUser({ id: 72, roles: ["User"], tenantId: testTenantId(72) });
    const res = await stack.http.query(
      TemplateResolverQueries.documentBlocks,
      { slug: SLUG, kind: "mail", locale: LOCALE },
      user,
    );
    expect(res.status).toBe(403);
  });
});

describe("template-resolver :: patch-draft write", () => {
  test("setMeta over a system template creates the caller's tenant draft", async () => {
    const admin = adminOf(73);
    const system = await blocksOf(SLUG, admin);
    const res = await patchOf(
      SLUG,
      system.base,
      [{ op: "setMeta", meta: { subject: "Neu {{invoiceNumber}}" } }],
      admin,
    );
    expect(res.status).toBe(200);
    const after = await blocksOf(SLUG, admin);
    expect(after.base.scope).toBe("tenant");
    expect(after.status).toBe("draft");
    expect(after.meta["subject"]).toBe("Neu {{invoiceNumber}}");
    expect(after.blocks).toHaveLength(3);
    const stale = await patchOf(SLUG, system.base, [{ op: "removeBlock", blockId: "b1" }], admin);
    expect(stale.status).toBe(409);
  });

  test("a logo inserted over an active template lands in a draft beside it", async () => {
    const admin = adminOf(74);
    const created = await storeFreeTemplate(admin, "active");
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId: await uploadImage(admin), templateId: created.id, key: "banner" },
      admin,
    );
    const before = await blocksOf(FREE_SLUG, admin);
    expect(before.resourceKeys).toContain("banner");
    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: FREE_SLUG,
        kind: "mail",
        locale: LOCALE,
        base: before.base,
        ops: [
          {
            op: "insertBlock",
            after: null,
            block: { type: "image", resource: "banner", alt: "Logo" },
          },
        ],
      },
      admin,
    );
    const after = await blocksOf(FREE_SLUG, admin);
    expect(after.status).toBe("draft");
    expect(after.blocks[0]).toMatchObject({ type: "image", resource: "banner" });

    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      id: created.id,
    });
    expect(row?.status).toBe("active");
    expect(row?.content).not.toContain("banner");
    expect(row?.draft).toContain("data-resource");

    const validation = await stack.http.queryOk<{ warnings: Array<{ code: string }> }>(
      TemplateResolverQueries.validate,
      {
        slug: FREE_SLUG,
        kind: "mail",
        contentFormat: "html",
        content:
          '<p><img data-resource="banner"></p><p>Hallo <span data-variable="name"></span></p>',
        meta: { subject: "Hallo {{name}}" },
        variableSchema: { name: { type: "text", required: true } },
        locale: LOCALE,
      },
      admin,
    );
    expect(validation.warnings.some((warning) => warning.code === "resource_not_uploaded")).toBe(
      false,
    );
  });

  test("setMeta changes the subject and leaves a draft", async () => {
    const admin = adminOf(75);
    await storeFreeTemplate(admin);
    const before = await blocksOf(FREE_SLUG, admin);
    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: FREE_SLUG,
        kind: "mail",
        locale: LOCALE,
        base: before.base,
        ops: [{ op: "setMeta", meta: { subject: "Betreff {{name}}" } }],
      },
      admin,
    );
    const after = await blocksOf(FREE_SLUG, admin);
    expect(after.meta["subject"]).toBe("Betreff {{name}}");
    expect(after.status).toBe("draft");
    expect(after.base.version).toBeGreaterThan(before.base.version);
  });

  test("removing the block with the only use of a required placeholder is refused", async () => {
    const admin = adminOf(76);
    await storeFreeTemplate(admin);
    const before = await blocksOf(FREE_SLUG, admin);
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.patchDraft,
      {
        slug: FREE_SLUG,
        kind: "mail",
        locale: LOCALE,
        base: before.base,
        ops: [
          { op: "removeBlock", blockId: "b0" },
          { op: "setMeta", meta: { subject: "Fest" } },
        ],
      },
      admin,
    );
    expect(err.code).toBe("validation_error");
    expectErrorIncludes(err, "required_placeholder_removed");
    expectErrorIncludes(err, "name");
    expect((await blocksOf(FREE_SLUG, admin)).base.version).toBe(before.base.version);
  });

  test("a patch against an outdated base is a version conflict and writes nothing", async () => {
    const admin = adminOf(77);
    await storeFreeTemplate(admin);
    const stale = (await blocksOf(FREE_SLUG, admin)).base;
    const first = await patchOf(
      FREE_SLUG,
      stale,
      [{ op: "replaceText", blockId: "b1", find: "Zweiter", replace: "Geänderter" }],
      admin,
    );
    expect(first.status).toBe(200);
    const second = await patchOf(FREE_SLUG, stale, [{ op: "removeBlock", blockId: "b2" }], admin);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      "version_conflict",
    );
    const after = await blocksOf(FREE_SLUG, admin);
    expect(after.blocks.map((block) => block.text)).toContain("Geänderter Absatz");
    expect(after.blocks).toHaveLength(3);
  });

  test("an op that does not fit the document is reported with its path", async () => {
    const admin = adminOf(78);
    await storeFreeTemplate(admin);
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.patchDraft,
      {
        slug: FREE_SLUG,
        kind: "mail",
        locale: LOCALE,
        base: (await blocksOf(FREE_SLUG, admin)).base,
        ops: [{ op: "removeBlock", blockId: "b42" }],
      },
      admin,
    );
    expectErrorIncludes(err, "ops.0.blockId");
    expectErrorIncludes(err, "unknown_block");
  });

  test("the role User is refused", async () => {
    const user = createTestUser({ id: 79, roles: ["User"], tenantId: testTenantId(79) });
    const res = await stack.http.write(
      TemplateResolverHandlers.patchDraft,
      {
        slug: SLUG,
        kind: "mail",
        locale: LOCALE,
        base: { scope: "system", version: 1 },
        ops: [{ op: "removeBlock", blockId: "b0" }],
      },
      user,
    );
    expect(res.status).toBe(403);
  });

  test("setVariable on a template whose variables a notification declares is refused", async () => {
    const admin = adminOf(80);
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.patchDraft,
      {
        slug: SLUG,
        kind: "mail",
        locale: LOCALE,
        base: (await blocksOf(SLUG, admin)).base,
        ops: [{ op: "setVariable", name: "extra", definition: { type: "text" } }],
      },
      admin,
    );
    expectErrorIncludes(err, "variables_declared_by_feature");
  });
});
