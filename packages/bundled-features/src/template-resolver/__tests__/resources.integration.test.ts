// Template image resources: the upload goes through the real multipart POST /api/files, then
// resource-upload turns the caller's unclaimed upload into a normalized resource. Real stack,
// real HTTP calls, no hand-fed rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  expectErrorIncludes,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import sharp from "sharp";
import { createTemplateResolverFeature } from "../feature.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.ts";
import { templateResourceEntity } from "../table.ts";

const noteEntity = createEntity({
  table: "resource_test_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    attachment: createFileField(),
  },
});

const noteFeature = defineFeature("resource-test-notes", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.writeHandler(
    defineEntityCreateHandler("note", noteEntity, {
      access: { roles: ["TenantAdmin", "SystemAdmin"] },
    }),
  );
});

const systemAdmin = TestUsers.systemAdmin;
const tenantA_Admin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const tenantA_OtherAdmin = createTestUser({
  id: 5,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(10),
});
const normalUser = createTestUser({ id: 4, tenantId: testTenantId(10) });
const tenantB_Admin = createTestUser({ id: 3, roles: ["TenantAdmin"], tenantId: testTenantId(20) });

const provider = createInMemoryFileProvider();
let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), createTemplateResolverFeature(), noteFeature],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

async function png(width: number, height = width): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

// Incompressible noise: a PNG of it stays above the default 2 MiB cap.
async function noisyPng(side: number): Promise<Buffer> {
  return sharp(randomBytes(side * side * 3), { raw: { width: side, height: side, channels: 3 } })
    .png()
    .toBuffer();
}

async function upload(
  as: typeof tenantA_Admin,
  bytes: Uint8Array,
  file: { name: string; type: string },
  fields: { entityType?: string; fieldName?: string } = {},
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
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

const uploadPng = (as: typeof tenantA_Admin, bytes: Uint8Array) =>
  upload(as, bytes, { name: "logo.png", type: "image/png" });

type UploadResult = {
  fileRefId: string;
  key?: string;
  contentType: string;
  width: number;
  height: number;
  size: number;
};

async function createTenantTemplate(as: typeof tenantA_Admin, slug: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertTenant,
    {
      slug,
      kind: "mail",
      meta: { subject: "Hello" },
      locale: "de",
      content: "<p>Hello</p>",
      contentFormat: "html",
      variableSchema: {},
    },
    as,
  );
  return created.id;
}

async function createSystemTemplate(slug: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertSystem,
    {
      slug,
      kind: "mail",
      meta: { subject: "Hello" },
      locale: "de",
      content: "<p>Hello</p>",
      contentFormat: "html",
      variableSchema: {},
    },
    systemAdmin,
  );
  return created.id;
}

async function linkedResourcesOf(templateId: string, as: typeof tenantA_Admin): Promise<unknown> {
  const found = await stack.http.queryOk<{ linkedResources: string } | null>(
    TemplateResolverQueries.findById,
    { id: templateId },
    as,
  );
  return JSON.parse(found?.linkedResources ?? "{}");
}

async function storedBytes(fileRefId: string): Promise<{ bytes: Uint8Array; tenantId: string }> {
  const [row] = await selectMany<{ storageKey: string; tenantId: string }>(
    stack.db,
    fileRefsTable,
    { id: fileRefId },
  );
  if (row === undefined) throw new Error(`no file ref ${fileRefId}`);
  return { bytes: await provider.read(row.storageKey), tenantId: row.tenantId };
}

describe("template-resolver :: resource-upload", () => {
  test("links a normalized copy of the caller's upload into the template", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-basic");
    const sourceFileRefId = await uploadPng(tenantA_Admin, await png(40, 20));

    const result = await stack.http.writeOk<UploadResult>(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantA_Admin,
    );

    expect(result).toMatchObject({ key: "logo", contentType: "image/png", width: 40, height: 20 });
    expect(result.fileRefId).not.toBe(sourceFileRefId);
    expect(await linkedResourcesOf(templateId, tenantA_Admin)).toEqual({ logo: result.fileRefId });

    const stored = await storedBytes(result.fileRefId);
    expect(stored.tenantId).toBe(tenantA_Admin.tenantId);
    const meta = await sharp(stored.bytes).metadata();
    expect(meta).toMatchObject({ format: "png", width: 40, height: 20 });
  });

  test("a 2000 px wide image is stored at 1200 px", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-wide");
    const sourceFileRefId = await uploadPng(tenantA_Admin, await png(2000, 100));

    const result = await stack.http.writeOk<UploadResult>(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "banner" },
      tenantA_Admin,
    );

    expect(result.width).toBe(1200);
    const meta = await sharp((await storedBytes(result.fileRefId)).bytes).metadata();
    expect(meta.width).toBe(1200);
  });

  test("without templateId only the file is created", async () => {
    const sourceFileRefId = await uploadPng(tenantA_Admin, await png(16));
    const result = await stack.http.writeOk<UploadResult>(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId },
      tenantA_Admin,
    );
    expect(result.fileRefId).toBeString();
    expect(result.key).toBeUndefined();
    expect((await storedBytes(result.fileRefId)).tenantId).toBe(tenantA_Admin.tenantId);
  });

  test("templateId without key is a validation error", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-half");
    const sourceFileRefId = await uploadPng(tenantA_Admin, await png(16));
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId },
      tenantA_Admin,
    );
    expectErrorIncludes(err, "validation_error");
  });

  test("an upload above the cap fails with template_resource_too_large", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-big");
    const big = await noisyPng(1000);
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
    const sourceFileRefId = await uploadPng(tenantA_Admin, big);

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantA_Admin,
    );
    expectErrorIncludes(err, '"reason":"template_resource_too_large"');
    expect(await linkedResourcesOf(templateId, tenantA_Admin)).toEqual({});
  });

  test("an SVG fails with template_resource_unsupported_image", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-svg");
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    const sourceFileRefId = await upload(tenantA_Admin, svg, {
      name: "logo.svg",
      type: "image/svg+xml",
    });
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantA_Admin,
    );
    expectErrorIncludes(err, '"reason":"template_resource_unsupported_image"');
  });

  test("a non-image upload fails with template_resource_unsupported_image", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-pdf");
    const sourceFileRefId = await upload(
      tenantA_Admin,
      new TextEncoder().encode("%PDF-1.4 minimal"),
      { name: "doc.pdf", type: "application/pdf" },
    );
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantA_Admin,
    );
    expectErrorIncludes(err, '"reason":"template_resource_unsupported_image"');
  });

  test("another user's upload is not found", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-foreign-user");
    const sourceFileRefId = await uploadPng(tenantA_OtherAdmin, await png(16));
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantA_Admin,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("a file bound to an entity field is not found", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-bound");
    const sourceFileRefId = await upload(
      tenantA_Admin,
      await png(16),
      { name: "logo.png", type: "image/png" },
      { entityType: "note", fieldName: "attachment" },
    );
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantA_Admin,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("an upload of another tenant is not found", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-foreign-tenant");
    const sourceFileRefId = await uploadPng(tenantB_Admin, await png(16));
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantA_Admin,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("a TenantAdmin cannot change a system template", async () => {
    const systemTemplateId = await createSystemTemplate("res-system-guard");
    const sourceFileRefId = await uploadPng(tenantA_Admin, await png(16));
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId: systemTemplateId, key: "logo" },
      tenantA_Admin,
    );
    expect(err.httpStatus).toBe(404);
    expect(await linkedResourcesOf(systemTemplateId, systemAdmin)).toEqual({});
  });

  test("a TenantAdmin cannot change another tenant's template", async () => {
    const foreignTemplateId = await createTenantTemplate(tenantB_Admin, "res-other-tenant");
    const sourceFileRefId = await uploadPng(tenantA_Admin, await png(16));
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId: foreignTemplateId, key: "logo" },
      tenantA_Admin,
    );
    expect(err.httpStatus).toBe(404);
    expect(await linkedResourcesOf(foreignTemplateId, tenantB_Admin)).toEqual({});
  });

  test("a TenantAdmin cannot target another tenant via tenantIdOverride", async () => {
    const foreignTemplateId = await createTenantTemplate(tenantB_Admin, "res-override-denied");
    const sourceFileRefId = await uploadPng(tenantA_Admin, await png(16));
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId,
        templateId: foreignTemplateId,
        key: "logo",
        tenantIdOverride: tenantB_Admin.tenantId,
      },
      tenantA_Admin,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    expect(await linkedResourcesOf(foreignTemplateId, tenantB_Admin)).toEqual({});
  });

  test("a SystemAdmin links into a system template; the file lands in the system tenant", async () => {
    const systemTemplateId = await createSystemTemplate("res-system-ok");
    const sourceFileRefId = await uploadPng(systemAdmin, await png(24));

    const result = await stack.http.writeOk<UploadResult>(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId,
        templateId: systemTemplateId,
        key: "logo",
        tenantIdOverride: SYSTEM_TENANT_ID,
      },
      systemAdmin,
    );

    expect(await linkedResourcesOf(systemTemplateId, systemAdmin)).toEqual({
      logo: result.fileRefId,
    });
    expect((await storedBytes(result.fileRefId)).tenantId).toBe(SYSTEM_TENANT_ID);
  });
});

describe("template-resolver :: access", () => {
  test("resource-upload rejects a caller without TenantAdmin", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId: "00000000-0000-4000-8000-000000000001" },
      normalUser,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("resource-remove rejects a caller without TenantAdmin", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceRemove,
      { templateId: "00000000-0000-4000-8000-000000000001", key: "logo" },
      normalUser,
    );
    expectErrorIncludes(err, "access_denied");
  });
});

describe("template-resolver :: resource-remove and upserts", () => {
  test("remove drops the key and keeps the others", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-remove");
    const logo = await stack.http.writeOk<UploadResult>(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId: await uploadPng(tenantA_Admin, await png(16)), templateId, key: "logo" },
      tenantA_Admin,
    );
    const seal = await stack.http.writeOk<UploadResult>(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId: await uploadPng(tenantA_Admin, await png(16)), templateId, key: "seal" },
      tenantA_Admin,
    );

    const removed = await stack.http.writeOk<{ removed: boolean }>(
      TemplateResolverHandlers.resourceRemove,
      { templateId, key: "logo" },
      tenantA_Admin,
    );
    expect(removed.removed).toBe(true);
    expect(await linkedResourcesOf(templateId, tenantA_Admin)).toEqual({ seal: seal.fileRefId });
    expect(logo.fileRefId).not.toBe(seal.fileRefId);
  });

  test("a TenantAdmin cannot remove a key of a system template", async () => {
    const systemTemplateId = await createSystemTemplate("res-remove-guard");
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceRemove,
      { templateId: systemTemplateId, key: "logo" },
      tenantA_Admin,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("upsertTenant ignores a linkedResources payload on create", async () => {
    const foreignFileRefId = (
      await stack.http.writeOk<UploadResult>(
        TemplateResolverHandlers.resourceUpload,
        { sourceFileRefId: await uploadPng(systemAdmin, await png(16)) },
        systemAdmin,
      )
    ).fileRefId;

    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: "res-upsert-create",
        kind: "mail",
        meta: { subject: "Hello" },
        locale: "de",
        content: "<p>Hello</p>",
        contentFormat: "html",
        variableSchema: {},
        linkedResources: { logo: foreignFileRefId },
      },
      tenantA_Admin,
    );

    expect(await linkedResourcesOf(created.id, tenantA_Admin)).toEqual({});
  });

  test("upsertTenant update keeps the existing linkedResources", async () => {
    const templateId = await createTenantTemplate(tenantA_Admin, "res-upsert-keeps");
    const uploaded = await stack.http.writeOk<UploadResult>(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId: await uploadPng(tenantA_Admin, await png(16)), templateId, key: "logo" },
      tenantA_Admin,
    );

    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: "res-upsert-keeps",
        kind: "mail",
        meta: { subject: "Hello" },
        locale: "de",
        content: "<p>Changed</p>",
        contentFormat: "html",
        variableSchema: {},
        linkedResources: { logo: "00000000-0000-4000-8000-000000000001" },
      },
      tenantA_Admin,
    );

    expect(await linkedResourcesOf(templateId, tenantA_Admin)).toEqual({
      logo: uploaded.fileRefId,
    });
  });
});
