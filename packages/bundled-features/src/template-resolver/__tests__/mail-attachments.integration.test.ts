// Mail attachments and system copy-locale through the real stack: the file goes up via the
// multipart POST /api/files, resource-upload turns it into a stored attachment entry of a mail
// template, and the other handlers carry or refuse it. No hand-fed rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  expectErrorIncludes,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import { createTemplateResolverFeature } from "../feature.js";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.js";
import { templateResourceEntity } from "../table.js";

const tenantA = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const tenantB = createTestUser({ id: 3, roles: ["TenantAdmin"], tenantId: testTenantId(20) });
const systemAdmin = TestUsers.systemAdmin;
type Caller = typeof tenantA | typeof systemAdmin;

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const provider = createInMemoryFileProvider();
let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), createTemplateResolverFeature()],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function upload(
  as: Caller,
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

const uploadPdf = (as: Caller, bytes: Uint8Array = PDF_BYTES) =>
  upload(as, bytes, { name: "offer.pdf", type: "application/pdf" });

type AttachmentResult = {
  fileRefId: string;
  key: string;
  fileName: string;
  contentType: string;
  size: number;
};

async function createTemplate(
  as: Caller,
  slug: string,
  kind: "mail" | "document-pdf" = "mail",
  locale = "de",
): Promise<string> {
  const handler =
    as === systemAdmin
      ? TemplateResolverHandlers.upsertSystem
      : TemplateResolverHandlers.upsertTenant;
  const created = await stack.http.writeOk<{ id: string }>(
    handler,
    {
      slug,
      kind,
      meta: kind === "mail" ? { subject: "Hello" } : {},
      locale,
      content: "<p>Hello</p>",
      contentFormat: "html",
      variableSchema: {},
    },
    as,
  );
  return created.id;
}

async function linkedOf(templateId: string, as: Caller) {
  const found = await stack.http.queryOk<{ linkedResources: string } | null>(
    TemplateResolverQueries.findById,
    { id: templateId },
    as,
  );
  return JSON.parse(found?.linkedResources ?? "{}") as Record<string, unknown>;
}

async function attach(
  as: Caller,
  templateId: string,
  key: string,
  fileName = "offer.pdf",
  bytes: Uint8Array = PDF_BYTES,
  type = "application/pdf",
): Promise<AttachmentResult> {
  const sourceFileRefId = await upload(as, bytes, { name: fileName, type });
  return stack.http.writeOk<AttachmentResult>(
    TemplateResolverHandlers.resourceUpload,
    { sourceFileRefId, templateId, key, purpose: "attachment", fileName },
    as,
  );
}

describe("template-resolver :: mail attachments", () => {
  test("a PDF is stored byte for byte and linked as a file entry", async () => {
    const templateId = await createTemplate(tenantA, "att-basic");
    const result = await attach(tenantA, templateId, "offer");

    expect(result).toMatchObject({
      key: "offer",
      fileName: "offer.pdf",
      contentType: "application/pdf",
    });
    expect(result.size).toBe(PDF_BYTES.length);
    expect(await linkedOf(templateId, tenantA)).toEqual({
      offer: { kind: "file", fileRefId: result.fileRefId, fileName: "offer.pdf" },
    });

    const [row] = await selectMany<{ storageKey: string; tenantId: string }>(
      stack.db,
      fileRefsTable,
      { id: result.fileRefId },
    );
    expect(row?.tenantId).toBe(tenantA.tenantId);
    expect(
      Buffer.from(await provider.read(row?.storageKey ?? "")).equals(Buffer.from(PDF_BYTES)),
    ).toBe(true);
  });

  test("a file that is not a PDF, PNG or JPEG is refused by its content", async () => {
    const templateId = await createTemplate(tenantA, "att-type");
    const sourceFileRefId = await upload(tenantA, new TextEncoder().encode("plain text"), {
      name: "offer.pdf",
      type: "application/pdf",
    });
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "offer", purpose: "attachment", fileName: "offer.pdf" },
      tenantA,
    );
    expectErrorIncludes(err, '"reason":"template_attachment_unsupported_type"');
    expect(await linkedOf(templateId, tenantA)).toEqual({});
  });

  test("an attachment needs template, key and a plain file name", async () => {
    const templateId = await createTemplate(tenantA, "att-invalid");
    const sourceFileRefId = await uploadPdf(tenantA);
    for (const payload of [
      { sourceFileRefId, purpose: "attachment", fileName: "a.pdf" },
      { sourceFileRefId, templateId, key: "offer", purpose: "attachment" },
      { sourceFileRefId, templateId, key: "offer", purpose: "attachment", fileName: "../a.pdf" },
    ]) {
      const err = await stack.http.writeErr(
        TemplateResolverHandlers.resourceUpload,
        payload,
        tenantA,
      );
      expectErrorIncludes(err, '"reason":"template_attachment_invalid"');
    }
  });

  test("only mail templates take attachments", async () => {
    const templateId = await createTemplate(tenantA, "att-pdf-kind", "document-pdf");
    const sourceFileRefId = await uploadPdf(tenantA);
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "offer", purpose: "attachment", fileName: "a.pdf" },
      tenantA,
    );
    expectErrorIncludes(err, '"reason":"template_attachment_invalid"');
  });

  test("the 11th attachment is refused, replacing an existing key is not", async () => {
    const templateId = await createTemplate(tenantA, "att-limit");
    for (let index = 0; index < 10; index++) await attach(tenantA, templateId, `file${index}`);

    const sourceFileRefId = await uploadPdf(tenantA);
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "file10", purpose: "attachment", fileName: "a.pdf" },
      tenantA,
    );
    expectErrorIncludes(err, '"reason":"template_attachment_limit"');

    await attach(tenantA, templateId, "file0");
    expect(Object.keys(await linkedOf(templateId, tenantA))).toHaveLength(10);
  });

  test("an upload of another tenant is not found", async () => {
    const templateId = await createTemplate(tenantB, "att-foreign");
    const foreign = await uploadPdf(tenantA);
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId: foreign,
        templateId,
        key: "offer",
        purpose: "attachment",
        fileName: "a.pdf",
      },
      tenantB,
    );
    expect(err.httpStatus).toBe(404);
    expect(await linkedOf(templateId, tenantB)).toEqual({});
  });

  test("resource-remove unlinks an attachment", async () => {
    const templateId = await createTemplate(tenantA, "att-remove");
    await attach(tenantA, templateId, "offer");
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceRemove,
      { templateId, key: "offer" },
      tenantA,
    );
    expect(await linkedOf(templateId, tenantA)).toEqual({});
  });

  test("copy-locale carries the attachment entry", async () => {
    const templateId = await createTemplate(tenantA, "att-copy");
    await attach(tenantA, templateId, "offer");
    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      { slug: "att-copy", kind: "mail", fromLocale: "de", toLocale: "en" },
      tenantA,
    );
    const linked = await linkedOf(copied.id, tenantA);
    expect(Object.keys(linked)).toEqual(["offer"]);
    expect(linked["offer"]).toMatchObject({ kind: "file", fileName: "offer.pdf" });
  });

  test("an exported bundle imports with its attachment", async () => {
    const templateId = await createTemplate(tenantA, "att-bundle");
    await attach(tenantA, templateId, "offer");
    const bundle = await stack.http.queryOk<{
      slug: string;
      resources: Record<string, { purpose?: string; fileName: string; base64: string }>;
    }>(TemplateResolverQueries.exportBundle, { slug: "att-bundle", kind: "mail" }, tenantA);
    expect(bundle.resources["offer"]).toMatchObject({
      purpose: "attachment",
      fileName: "offer.pdf",
    });
    expect(
      Buffer.from(bundle.resources["offer"]?.base64 ?? "", "base64").equals(Buffer.from(PDF_BYTES)),
    ).toBe(true);

    await stack.http.writeOk(TemplateResolverHandlers.importBundle, { bundle }, tenantB);
    const again = await stack.http.queryOk<typeof bundle>(
      TemplateResolverQueries.exportBundle,
      { slug: "att-bundle", kind: "mail" },
      tenantB,
    );
    expect(again.resources["offer"]).toMatchObject({
      purpose: "attachment",
      fileName: "offer.pdf",
    });
  });

  test("a bundle attachment above ten entries is refused", async () => {
    const resources = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `file${index}`,
        {
          fileName: "a.pdf",
          contentType: "application/pdf",
          base64: Buffer.from(PDF_BYTES).toString("base64"),
          purpose: "attachment",
        },
      ]),
    );
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      {
        bundle: {
          slug: "att-bundle-many",
          kind: "mail",
          contentFormat: "html",
          locales: { de: { body: "<p>x</p>", meta: { subject: "Hi" } } },
          resources,
        },
      },
      tenantA,
    );
    expectErrorIncludes(err, '"reason":"template_attachment_limit"');
  });
});

describe("template-resolver :: copy-locale scope system", () => {
  test("a system admin copies a system template into another locale as a draft", async () => {
    await createTemplate(systemAdmin, "att-system-copy");
    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      { slug: "att-system-copy", kind: "mail", fromLocale: "de", toLocale: "en", scope: "system" },
      systemAdmin,
    );
    const found = await stack.http.queryOk<{
      scope: string;
      locale: string;
      status: string;
    } | null>(TemplateResolverQueries.findById, { id: copied.id }, systemAdmin);
    expect(found).toMatchObject({ scope: "system", locale: "en", status: "draft" });
  });

  test("a tenant admin is refused", async () => {
    await createTemplate(systemAdmin, "att-system-denied");
    const res = await stack.http.write(
      TemplateResolverHandlers.copyLocale,
      {
        slug: "att-system-denied",
        kind: "mail",
        fromLocale: "de",
        toLocale: "en",
        scope: "system",
      },
      tenantA,
    );
    expect(res.status).toBe(403);
  });
});
