// Mail attachments and system copy-locale through the real stack: the file goes up via the
// multipart POST /api/files, resource-upload turns it into a stored attachment entry of a mail
// template, and the other handlers carry or refuse it. No hand-fed rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
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
import { templateResourceEntity } from "../table.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const TENANT_EDITABLE = tenantEditableTemplates(
  ["mail", "document-pdf"],
  [
    "att-copy",
    "att-bundle",
    "att-bundle-many",
    "link-round",
    "link-bundle-bad",
    "att-system-copy",
    "att-system-denied",
    "copy-archived-source",
    "copy-system-files",
    "export-mixed-format",
    "att-basic",
    "att-foreign",
    "att-invalid",
    "att-key-in-use",
    "att-limit",
    "att-pdf-kind",
    "att-remove",
    "att-type",
    "link-archived",
    "link-archived-doc",
    "link-basic",
    "link-foreign",
    "link-foreign-doc",
    "link-invalid",
    "link-kind",
    "link-kind-doc",
    "link-limit",
    "link-limit-doc",
    "link-missing",
    "link-nonexistent",
    "link-only-mail",
    "link-round-doc",
    "link-scope",
    "link-scope-doc",
    "link-valid-doc",
    "rendered-pdf",
  ],
);

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
    features: [
      createFilesFeature(),
      createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }),
    ],
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
      name: "offer.txt",
      type: "text/plain",
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

  test("an attachment cannot replace the inline image under its key, nor an image the attachment", async () => {
    const templateId = await createTemplate(tenantA, "att-key-in-use");
    const logo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const imagePayload = async (key: string) => ({
      sourceFileRefId: await upload(tenantA, logo, { name: "logo.png", type: "image/png" }),
      templateId,
      key,
      purpose: "image",
    });
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceUpload,
      await imagePayload("logo"),
      tenantA,
    );
    await attach(tenantA, templateId, "offer");
    const before = await linkedOf(templateId, tenantA);

    const attachOverImage = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId: await uploadPdf(tenantA),
        templateId,
        key: "logo",
        purpose: "attachment",
        fileName: "a.pdf",
      },
      tenantA,
    );
    const imageOverAttachment = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      await imagePayload("offer"),
      tenantA,
    );

    expectErrorIncludes(attachOverImage, '"code":"key_in_use"');
    expectErrorIncludes(imageOverAttachment, '"code":"key_in_use"');
    expect(await linkedOf(templateId, tenantA)).toEqual(before);
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

describe("template-resolver :: linked PDF template", () => {
  const link = (as: Caller, payload: Record<string, unknown>) =>
    stack.http.writeErr(TemplateResolverHandlers.resourceLinkPdf, payload, as);

  test("links a system document template and stores only the entry", async () => {
    await createTemplate(systemAdmin, "billing:link-invoice", "document-pdf");
    const templateId = await createTemplate(tenantA, "link-basic");
    const result = await stack.http.writeOk(
      TemplateResolverHandlers.resourceLinkPdf,
      {
        templateId,
        key: "invoice",
        templateSlug: "billing:link-invoice",
        fileName: "rechnung-{{number}}.pdf",
      },
      tenantA,
    );
    expect(result).toEqual({
      key: "invoice",
      templateSlug: "billing:link-invoice",
      fileName: "rechnung-{{number}}.pdf",
    });
    expect(await linkedOf(templateId, tenantA)).toEqual({
      invoice: {
        kind: "rendered-pdf",
        templateSlug: "billing:link-invoice",
        fileName: "rechnung-{{number}}.pdf",
      },
    });
  });

  test("a document template that exists nowhere is refused, also a mail template slug", async () => {
    await createTemplate(systemAdmin, "link-only-mail");
    const templateId = await createTemplate(tenantA, "link-missing");
    for (const templateSlug of ["link-nonexistent", "link-only-mail"]) {
      const res = await link(tenantA, {
        templateId,
        key: "invoice",
        templateSlug,
        fileName: "a.pdf",
      });
      expectErrorIncludes(res, '"reason":"template_attachment_pdf_template_missing"');
    }
    expect(await linkedOf(templateId, tenantA)).toEqual({});
  });

  test("a document template of another tenant does not count", async () => {
    await createTemplate(tenantB, "link-foreign-doc", "document-pdf");
    const templateId = await createTemplate(tenantA, "link-foreign");
    const res = await link(tenantA, {
      templateId,
      key: "invoice",
      templateSlug: "link-foreign-doc",
      fileName: "a.pdf",
    });
    expectErrorIncludes(res, '"reason":"template_attachment_pdf_template_missing"');
  });

  test("an archived document template does not count as linkable", async () => {
    const docId = await createTemplate(systemAdmin, "link-archived-doc", "document-pdf");
    await stack.http.writeOk(TemplateResolverHandlers.archiveSystem, { id: docId }, systemAdmin);
    const templateId = await createTemplate(tenantA, "link-archived");
    const res = await link(tenantA, {
      templateId,
      key: "invoice",
      templateSlug: "link-archived-doc",
      fileName: "a.pdf",
    });
    expectErrorIncludes(res, '"reason":"template_attachment_pdf_template_missing"');
    expect(await linkedOf(templateId, tenantA)).toEqual({});
  });

  test("a bad file name pattern or slug is refused as invalid", async () => {
    await createTemplate(systemAdmin, "link-valid-doc", "document-pdf");
    const templateId = await createTemplate(tenantA, "link-invalid");
    for (const fileName of ["a.txt", "../a.pdf", "a/b.pdf", "a\nb.pdf", `${"a".repeat(200)}.pdf`]) {
      const res = await link(tenantA, {
        templateId,
        key: "invoice",
        templateSlug: "link-valid-doc",
        fileName,
      });
      expectErrorIncludes(res, '"reason":"template_attachment_invalid"');
    }
    const badSlug = await link(tenantA, {
      templateId,
      key: "invoice",
      templateSlug: "Not A Slug",
      fileName: "a.pdf",
    });
    expectErrorIncludes(badSlug, '"reason":"template_attachment_invalid"');
  });

  test("only mail templates take a linked PDF", async () => {
    await createTemplate(systemAdmin, "link-kind-doc", "document-pdf");
    const templateId = await createTemplate(tenantA, "link-kind", "document-pdf");
    const res = await link(tenantA, {
      templateId,
      key: "invoice",
      templateSlug: "link-kind-doc",
      fileName: "a.pdf",
    });
    expectErrorIncludes(res, '"reason":"template_attachment_invalid"');
  });

  test("files and linked PDFs share the limit of ten", async () => {
    await createTemplate(systemAdmin, "link-limit-doc", "document-pdf");
    const templateId = await createTemplate(tenantA, "link-limit");
    for (let index = 0; index < 5; index++) await attach(tenantA, templateId, `file${index}`);
    for (let index = 0; index < 5; index++) {
      await stack.http.writeOk(
        TemplateResolverHandlers.resourceLinkPdf,
        { templateId, key: `pdf${index}`, templateSlug: "link-limit-doc", fileName: "a.pdf" },
        tenantA,
      );
    }
    const refused = await link(tenantA, {
      templateId,
      key: "pdf5",
      templateSlug: "link-limit-doc",
      fileName: "a.pdf",
    });
    expectErrorIncludes(refused, '"reason":"template_attachment_limit"');

    const uploadErr = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId: await uploadPdf(tenantA),
        templateId,
        key: "file5",
        purpose: "attachment",
        fileName: "a.pdf",
      },
      tenantA,
    );
    expectErrorIncludes(uploadErr, '"reason":"template_attachment_limit"');

    await stack.http.writeOk(
      TemplateResolverHandlers.resourceLinkPdf,
      { templateId, key: "pdf0", templateSlug: "link-limit-doc", fileName: "renamed.pdf" },
      tenantA,
    );
    expect(Object.keys(await linkedOf(templateId, tenantA))).toHaveLength(10);
  });

  test("a template of another tenant cannot be linked into", async () => {
    await createTemplate(systemAdmin, "link-scope-doc", "document-pdf");
    const foreignId = await createTemplate(tenantB, "link-scope");
    const res = await link(tenantA, {
      templateId: foreignId,
      key: "invoice",
      templateSlug: "link-scope-doc",
      fileName: "a.pdf",
    });
    expect(res.httpStatus).toBe(403);
    expect(await linkedOf(foreignId, tenantB)).toEqual({});
  });

  test("resource-remove, copy-locale and the bundle round trip carry the entry", async () => {
    await createTemplate(systemAdmin, "link-round-doc", "document-pdf");
    const templateId = await createTemplate(tenantA, "link-round");
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceLinkPdf,
      { templateId, key: "invoice", templateSlug: "link-round-doc", fileName: "r-{{n}}.pdf" },
      tenantA,
    );
    const entry = { kind: "rendered-pdf", templateSlug: "link-round-doc", fileName: "r-{{n}}.pdf" };

    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      { slug: "link-round", kind: "mail", fromLocale: "de", toLocale: "en" },
      tenantA,
    );
    expect(await linkedOf(copied.id, tenantA)).toEqual({ invoice: entry });

    const bundle = await stack.http.queryOk<{
      pdfAttachments: Record<string, unknown>;
      resources: Record<string, unknown>;
    }>(TemplateResolverQueries.exportBundle, { slug: "link-round", kind: "mail" }, tenantA);
    expect(bundle.resources).toEqual({});
    expect(bundle.pdfAttachments).toEqual({
      invoice: { templateSlug: "link-round-doc", fileName: "r-{{n}}.pdf" },
    });

    // The document template does not exist for tenantB: import does not check, send would fail.
    await stack.http.writeOk(TemplateResolverHandlers.importBundle, { bundle }, tenantB);
    const imported = await stack.http.queryOk<{ pdfAttachments: Record<string, unknown> }>(
      TemplateResolverQueries.exportBundle,
      { slug: "link-round", kind: "mail" },
      tenantB,
    );
    expect(imported.pdfAttachments).toEqual(bundle.pdfAttachments);

    await stack.http.writeOk(
      TemplateResolverHandlers.resourceRemove,
      { templateId, key: "invoice" },
      tenantA,
    );
    expect(await linkedOf(templateId, tenantA)).toEqual({});
  });

  test("a bundle with an invalid PDF link or a key used twice is refused", async () => {
    const base = {
      slug: "link-bundle-bad",
      kind: "mail",
      contentFormat: "html",
      locales: { de: { body: "<p>x</p>", meta: { subject: "Hi" } } },
    };
    const badName = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      {
        bundle: {
          ...base,
          pdfAttachments: { invoice: { templateSlug: "invoice", fileName: "../a.txt" } },
        },
      },
      tenantA,
    );
    expect(badName.httpStatus).toBe(400);

    const twice = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      {
        bundle: {
          ...base,
          resources: {
            invoice: {
              fileName: "a.pdf",
              contentType: "application/pdf",
              base64: Buffer.from(PDF_BYTES).toString("base64"),
              purpose: "attachment",
            },
          },
          pdfAttachments: { invoice: { templateSlug: "invoice", fileName: "a.pdf" } },
        },
      },
      tenantA,
    );
    expect(twice.httpStatus).toBe(400);
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

describe("template-resolver :: copy-locale source resolution", () => {
  async function contentOf(templateId: string, as: Caller): Promise<string | undefined> {
    const found = await stack.http.queryOk<{ content: string } | null>(
      TemplateResolverQueries.findById,
      { id: templateId },
      as,
    );
    return found?.content;
  }

  test("an archived tenant source is ignored and the active system row is copied", async () => {
    await createTemplate(systemAdmin, "copy-archived-source");
    const own = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: "copy-archived-source",
        kind: "mail",
        meta: { subject: "Hello" },
        locale: "de",
        content: "<p>tenant text</p>",
        contentFormat: "html",
        variableSchema: {},
        status: "active",
      },
      tenantA,
    );
    await stack.http.writeOk(TemplateResolverHandlers.archive, { id: own.id }, tenantA);

    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      { slug: "copy-archived-source", kind: "mail", fromLocale: "de", toLocale: "en" },
      tenantA,
    );
    expect(await contentOf(copied.id, tenantA)).toBe("<p>Hello</p>");
  });

  test("copy from the system default gives the tenant its own attachment files that export", async () => {
    const systemTemplateId = await createTemplate(systemAdmin, "copy-system-files");
    const sourceFileRefId = await uploadPdf(systemAdmin);
    const systemAttachment = await stack.http.writeOk<AttachmentResult>(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId,
        templateId: systemTemplateId,
        key: "offer",
        purpose: "attachment",
        fileName: "offer.pdf",
        tenantIdOverride: SYSTEM_TENANT_ID,
      },
      systemAdmin,
    );

    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      { slug: "copy-system-files", kind: "mail", fromLocale: "de", toLocale: "en" },
      tenantA,
    );
    const linked = await linkedOf(copied.id, tenantA);
    const entry = linked["offer"] as { kind: string; fileRefId: string; fileName: string };
    expect(entry).toMatchObject({ kind: "file", fileName: "offer.pdf" });
    expect(entry.fileRefId).not.toBe(systemAttachment.fileRefId);

    const [row] = await selectMany<{ tenantId: string }>(stack.db, fileRefsTable, {
      id: entry.fileRefId,
    });
    expect(row?.tenantId).toBe(tenantA.tenantId);

    const bundle = await stack.http.queryOk<{
      resources: Record<string, { base64: string }>;
    }>(TemplateResolverQueries.exportBundle, { slug: "copy-system-files", kind: "mail" }, tenantA);
    expect(
      Buffer.from(bundle.resources["offer"]?.base64 ?? "", "base64").equals(Buffer.from(PDF_BYTES)),
    ).toBe(true);
  });

  test("export-bundle refuses locales that differ in their variable schema", async () => {
    await createTemplate(tenantA, "export-mixed-format", "mail", "de");
    const second = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: "export-mixed-format",
        kind: "mail",
        meta: { subject: "Hello" },
        locale: "en",
        content: "<p>Hello</p>",
        contentFormat: "html",
        variableSchema: { name: { type: "string" } },
      },
      tenantA,
    );
    expect(second.id).toBeString();
    const err = await stack.http.queryErr(
      TemplateResolverQueries.exportBundle,
      { slug: "export-mixed-format", kind: "mail" },
      tenantA,
    );
    expectErrorIncludes(err, "bundle_locales_differ");
  });
});
