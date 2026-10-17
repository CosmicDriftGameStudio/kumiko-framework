// resource-upload, import-bundle, import-bundle-system and copy-locale move all storage I/O in front of the
// transaction: the source is read and the binaries are written in the beforeTransaction phase, the
// transaction only creates fileRef rows and links them, and the phase's release removes the
// binaries when the transaction does not commit. Real stack, real HTTP calls.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { executeRawQuery, table as pgTable, uuid } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileRefFromBytes,
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createTemplateResolverFeature } from "../feature.js";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.js";
import { templateResourceEntity, templateResourcesTable } from "../table.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PDF_BASE64 = Buffer.from(PDF_BYTES).toString("base64");

const FIXTURE = "upload-fixture";
const SWITCH_FIXTURE = "upload-switch-fixture";
const SWITCH_UPLOAD = `${SWITCH_FIXTURE}:write:switch-upload`;
const SWITCH_BUNDLE = `${SWITCH_FIXTURE}:write:switch-bundle`;
const ORCHESTRATE_UPLOAD = `${FIXTURE}:write:orchestrate-upload`;
const ORCHESTRATE_BUNDLE = `${FIXTURE}:write:orchestrate-bundle`;
const NESTED_UPLOAD = `${FIXTURE}:write:nested-upload`;
const NESTED_BUNDLE = `${FIXTURE}:write:nested-bundle`;
const UPLOAD_IN_TRANSACTION = `${FIXTURE}:write:upload-in-transaction`;

const tenantAAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const tenantBAdmin = createTestUser({ id: 3, roles: ["TenantAdmin"], tenantId: testTenantId(11) });
const systemAdmin = TestUsers.systemAdmin;

const baseProvider = createInMemoryFileProvider();
// Storage calls observed while a connection sat in an open transaction.
const idleInTransactionAtStorageCall: number[] = [];

async function idleInTransactionCount(): Promise<number> {
  const rows = await executeRawQuery<{ count: number }>(
    stack.db,
    `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND state LIKE 'idle in transaction%'`,
  );
  return rows[0]?.count ?? -1;
}

const provider: InMemoryFileProvider = {
  ...baseProvider,
  async write(key, data, mimeType) {
    idleInTransactionAtStorageCall.push(await idleInTransactionCount());
    return baseProvider.write(key, data, mimeType);
  },
  async read(key) {
    idleInTransactionAtStorageCall.push(await idleInTransactionCount());
    return baseProvider.read(key);
  },
};

let failTemplateSaveInTransaction = false;
const failingProjectionTable = pgTable("upload_fixture_failing_projection", {
  id: uuid("id").primaryKey(),
});

const sourcePayload = z.object({
  sourceFileRefId: z.uuid(),
  templateId: z.string(),
  key: z.string(),
});
const bundlePayload = z.object({ bundle: z.unknown() });
const access = { roles: ["TenantAdmin"] };

const fixtureFeature = defineFeature(FIXTURE, (r) => {
  r.requires({ features: ["template-resolver"] });

  // An inline projection runs in the write transaction: failing it rolls back after the upload.
  const failInTransaction = async () => {
    if (failTemplateSaveInTransaction) throw new Error("forced in-transaction failure");
  };
  r.projection({
    name: "fail-template-save",
    source: "template-resource",
    table: failingProjectionTable,
    apply: {
      "template-resource.created": failInTransaction,
      "template-resource.updated": failInTransaction,
    },
  });

  r.writeHandler(
    defineWriteHandler({
      name: "orchestrate-upload",
      schema: sourcePayload,
      access,
      transaction: "perCommand",
      handler: (event, ctx) => ctx.write(TemplateResolverHandlers.resourceUpload, event.payload),
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "orchestrate-bundle",
      schema: bundlePayload,
      access,
      transaction: "perCommand",
      handler: (event, ctx) =>
        ctx.write(TemplateResolverHandlers.importBundle, { bundle: event.payload.bundle }),
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "nested-upload",
      schema: sourcePayload,
      access,
      handler: (event, ctx) => ctx.write(TemplateResolverHandlers.resourceUpload, event.payload),
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "nested-bundle",
      schema: bundlePayload,
      access,
      handler: (event, ctx) =>
        ctx.write(TemplateResolverHandlers.importBundle, { bundle: event.payload.bundle }),
    }),
  );
  // Control for the probe: storage I/O inside the transaction is observed as an open transaction.
  r.writeHandler(
    defineWriteHandler({
      name: "upload-in-transaction",
      schema: z.object({}),
      access,
      handler: (_event, ctx) =>
        createFileRefFromBytes(ctx, {
          fileName: "probe.pdf",
          mimeType: "application/pdf",
          data: PDF_BYTES,
        }),
    }),
  );
});

// writeAs needs an identity-switch grant; r.systemScope() on a separate feature keeps the grant
// away from the handlers above.
const switchFeature = defineFeature(SWITCH_FIXTURE, (r) => {
  r.requires({ features: ["template-resolver"] });
  r.systemScope();

  r.writeHandler(
    defineWriteHandler({
      name: "switch-upload",
      schema: sourcePayload,
      access,
      transaction: "perCommand",
      handler: (event, ctx) =>
        ctx.writeAs(tenantBAdmin, TemplateResolverHandlers.resourceUpload, event.payload),
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "switch-bundle",
      schema: bundlePayload,
      access,
      transaction: "perCommand",
      handler: (event, ctx) =>
        ctx.writeAs(tenantBAdmin, TemplateResolverHandlers.importBundle, {
          bundle: event.payload.bundle,
        }),
    }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createTemplateResolverFeature(),
      fixtureFeature,
      switchFeature,
    ],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  failTemplateSaveInTransaction = false;
  idleInTransactionAtStorageCall.length = 0;
});

async function uploadSource(
  as: typeof tenantAAdmin,
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

const uploadPng = (as: typeof tenantAAdmin) =>
  uploadSource(as, PNG_BYTES, { name: "logo.png", type: "image/png" });

async function createMailTemplate(as: typeof tenantAAdmin, slug: string): Promise<string> {
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

async function linkedResourcesOf(templateId: string, as: typeof tenantAAdmin): Promise<unknown> {
  const found = await stack.http.queryOk<{ linkedResources: string } | null>(
    TemplateResolverQueries.findById,
    { id: templateId },
    as,
  );
  return JSON.parse(found?.linkedResources ?? "{}");
}

async function fileRefCount(): Promise<number> {
  return (await selectMany(stack.db, fileRefsTable)).length;
}

type SystemTemplateFiles = {
  readonly slug: string;
  readonly imageFileRefId: string;
  readonly attachmentFileRefId: string;
};

// A system-default mail template with a linked image and a file attachment; copy-locale has to
// give the copying tenant its own files for both.
async function createSystemTemplateWithFiles(slug: string): Promise<SystemTemplateFiles> {
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
  const image = await stack.http.writeOk<{ fileRefId: string }>(
    TemplateResolverHandlers.resourceUpload,
    {
      sourceFileRefId: await uploadPng(systemAdmin),
      templateId: created.id,
      key: "logo",
      tenantIdOverride: SYSTEM_TENANT_ID,
    },
    systemAdmin,
  );
  const attachment = await stack.http.writeOk<{ fileRefId: string }>(
    TemplateResolverHandlers.resourceUpload,
    {
      sourceFileRefId: await uploadSource(systemAdmin, PDF_BYTES, {
        name: "offer.pdf",
        type: "application/pdf",
      }),
      templateId: created.id,
      key: "offer",
      purpose: "attachment",
      fileName: "offer.pdf",
      tenantIdOverride: SYSTEM_TENANT_ID,
    },
    systemAdmin,
  );
  return { slug, imageFileRefId: image.fileRefId, attachmentFileRefId: attachment.fileRefId };
}

const copyLocalePayload = (slug: string) => ({
  slug,
  kind: "mail" as const,
  fromLocale: "de",
  toLocale: "en",
});

type StoredFile = { readonly tenantId: string; readonly storageKey: string };

async function storedFileOf(fileRefId: string): Promise<StoredFile> {
  const [row] = await selectMany<StoredFile>(stack.db, fileRefsTable, { id: fileRefId });
  if (row === undefined) throw new Error(`fileRef ${fileRefId} not found`);
  return row;
}

async function storedBytesOf(fileRefId: string): Promise<Buffer> {
  return Buffer.from(await baseProvider.read((await storedFileOf(fileRefId)).storageKey));
}

function mailBundle(slug: string) {
  return {
    slug,
    kind: "mail" as const,
    contentFormat: "html" as const,
    locales: { de: { body: "<p>Hallo</p>", meta: { subject: "Hallo" } } },
    resources: {
      logo: { fileName: "logo.png", contentType: "image/png", base64: PNG_BASE64 },
      offer: {
        fileName: "offer.pdf",
        contentType: "application/pdf",
        base64: PDF_BASE64,
        purpose: "attachment" as const,
      },
    },
  };
}

type Snapshot = { readonly keys: readonly string[]; readonly fileRefs: number };

async function snapshot(): Promise<Snapshot> {
  return { keys: [...provider.keys()].sort(), fileRefs: await fileRefCount() };
}

async function expectUnchanged(before: Snapshot): Promise<void> {
  expect(await snapshot()).toEqual(before);
}

function expectNoTransactionOpenDuringStorageCalls(): void {
  expect(idleInTransactionAtStorageCall.length).toBeGreaterThan(0);
  expect(idleInTransactionAtStorageCall.every((count) => count === 0)).toBe(true);
}

describe("storage I/O runs without an open transaction", () => {
  test("the probe sees an open transaction when a handler stores inside it", async () => {
    await stack.http.writeOk(UPLOAD_IN_TRANSACTION, {}, tenantAAdmin);

    expect(idleInTransactionAtStorageCall.some((count) => count > 0)).toBe(true);
  });

  test("resource-upload reads the source and writes the binary with no transaction open", async () => {
    const templateId = await createMailTemplate(tenantAAdmin, "upload-no-tx");
    const sourceFileRefId = await uploadPng(tenantAAdmin);
    idleInTransactionAtStorageCall.length = 0;

    await stack.http.writeOk(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantAAdmin,
    );

    expectNoTransactionOpenDuringStorageCalls();
  });

  test("import-bundle writes every binary with no transaction open", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.importBundle,
      { bundle: mailBundle("bundle-no-tx") },
      tenantAAdmin,
    );

    expect(idleInTransactionAtStorageCall.length).toBe(2);
    expectNoTransactionOpenDuringStorageCalls();
  });
});

describe("copy-locale from the system default", () => {
  test("reads the source files and writes the copies with no transaction open", async () => {
    const files = await createSystemTemplateWithFiles("copy-no-tx");
    idleInTransactionAtStorageCall.length = 0;

    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      copyLocalePayload(files.slug),
      tenantAAdmin,
    );

    expect(idleInTransactionAtStorageCall.length).toBe(4);
    expectNoTransactionOpenDuringStorageCalls();

    const linked = (await linkedResourcesOf(copied.id, tenantAAdmin)) as {
      logo: string;
      offer: { kind: string; fileRefId: string; fileName: string };
    };
    expect(linked.logo).not.toBe(files.imageFileRefId);
    expect(linked.offer).toMatchObject({ kind: "file", fileName: "offer.pdf" });
    expect(linked.offer.fileRefId).not.toBe(files.attachmentFileRefId);
    expect(
      (await storedBytesOf(linked.logo)).equals(await storedBytesOf(files.imageFileRefId)),
    ).toBe(true);
    expect((await storedBytesOf(linked.offer.fileRefId)).equals(Buffer.from(PDF_BYTES))).toBe(true);
  });

  test("the copies land in the copying tenant's storage and fileRef rows", async () => {
    const files = await createSystemTemplateWithFiles("copy-tenant-scope");
    const keysBefore = new Set(provider.keys());
    const systemFileRefsBefore = await selectMany(stack.db, fileRefsTable, {
      tenantId: SYSTEM_TENANT_ID,
    });

    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      copyLocalePayload(files.slug),
      tenantAAdmin,
    );

    const linked = (await linkedResourcesOf(copied.id, tenantAAdmin)) as {
      logo: string;
      offer: { fileRefId: string };
    };
    for (const fileRefId of [linked.logo, linked.offer.fileRefId]) {
      const stored = await storedFileOf(fileRefId);
      expect(stored.tenantId).toBe(tenantAAdmin.tenantId);
      expect(stored.storageKey.startsWith(`${tenantAAdmin.tenantId}/`)).toBe(true);
    }
    const newKeys = provider.keys().filter((key) => !keysBefore.has(key));
    expect(newKeys).toHaveLength(2);
    expect(newKeys.every((key) => key.startsWith(`${tenantAAdmin.tenantId}/`))).toBe(true);
    expect(await selectMany(stack.db, fileRefsTable, { tenantId: SYSTEM_TENANT_ID })).toHaveLength(
      systemFileRefsBefore.length,
    );
  });
});

describe("a failure before the transaction stores nothing", () => {
  test("copy-locale onto an existing locale without overwrite uploads nothing", async () => {
    const files = await createSystemTemplateWithFiles("copy-target-exists");
    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      copyLocalePayload(files.slug),
      tenantAAdmin,
    );
    const before = await snapshot();

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.copyLocale,
      copyLocalePayload(files.slug),
      tenantAAdmin,
    );

    expect(JSON.stringify(err.details)).toContain("target_exists");
    await expectUnchanged(before);
  });

  test("an SVG source leaves no binary and no fileRef row", async () => {
    const templateId = await createMailTemplate(tenantAAdmin, "svg-nothing");
    const sourceFileRefId = await uploadSource(
      tenantAAdmin,
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
      { name: "logo.svg", type: "image/svg+xml" },
    );
    const before = await snapshot();

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantAAdmin,
    );

    expect(JSON.stringify(err.details)).toContain("template_resource_unsupported_image");
    await expectUnchanged(before);
  });

  test("an unknown template is refused before the image is uploaded", async () => {
    const sourceFileRefId = await uploadPng(tenantAAdmin);
    const before = await snapshot();

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId: crypto.randomUUID(), key: "logo" },
      tenantAAdmin,
    );

    expect(err.httpStatus).toBe(404);
    await expectUnchanged(before);
  });

  test("a TenantAdmin with tenantIdOverride is refused and nothing lands in the target tenant", async () => {
    const foreignTemplateId = await createMailTemplate(tenantBAdmin, "override-nothing");
    const sourceFileRefId = await uploadPng(tenantAAdmin);
    const before = await snapshot();

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      {
        sourceFileRefId,
        templateId: foreignTemplateId,
        key: "logo",
        tenantIdOverride: tenantBAdmin.tenantId,
      },
      tenantAAdmin,
    );

    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    expect(provider.keys().some((key) => key.startsWith(`${tenantBAdmin.tenantId}/`))).toBe(false);
    await expectUnchanged(before);
  });

  test("import-bundle-system with resources from a non-system tenant uploads nothing", async () => {
    const before = await snapshot();

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundleSystem,
      { bundle: mailBundle("system-no-upload") },
      systemAdmin,
    );

    expect(JSON.stringify(err.details)).toContain("system_resources_need_system_tenant");
    await expectUnchanged(before);
  });

  test("a bundle with an invalid locale uploads nothing", async () => {
    const before = await snapshot();
    const invalid = {
      ...mailBundle("bundle-bad-locale"),
      locales: { de_DE: { body: "<p>Hallo</p>", meta: { subject: "Hallo" } } },
    };

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      { bundle: invalid },
      tenantAAdmin,
    );

    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    await expectUnchanged(before);
  });

  test("a bundle whose template fails validation uploads nothing", async () => {
    const before = await snapshot();
    const invalid = {
      ...mailBundle("bundle-bad-meta"),
      locales: { de: { body: "<p>Hallo</p>", meta: {} } },
    };

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      { bundle: invalid },
      tenantAAdmin,
    );

    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    await expectUnchanged(before);
  });

  test("a bundle with attachments on a document template uploads nothing", async () => {
    const before = await snapshot();
    const invalid = {
      ...mailBundle("bundle-attachment-on-document"),
      kind: "document-pdf" as const,
      locales: { de: { body: "<p>Hallo</p>" } },
    };

    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      { bundle: invalid },
      tenantAAdmin,
    );

    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    await expectUnchanged(before);
  });
});

describe("a failure inside the transaction releases the uploaded binaries", () => {
  test("resource-upload: a failing link write leaves no binary and no fileRef row", async () => {
    const templateId = await createMailTemplate(tenantAAdmin, "release-upload");
    const sourceFileRefId = await uploadPng(tenantAAdmin);
    const before = await snapshot();

    failTemplateSaveInTransaction = true;
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId, key: "logo" },
      tenantAAdmin,
    );
    failTemplateSaveInTransaction = false;

    expect(err.httpStatus).toBe(500);
    await expectUnchanged(before);
    expect(await linkedResourcesOf(templateId, tenantAAdmin)).toEqual({});
  });

  test("import-bundle with two resources: a failing row write releases both binaries", async () => {
    const before = await snapshot();

    failTemplateSaveInTransaction = true;
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      { bundle: mailBundle("release-bundle") },
      tenantAAdmin,
    );
    failTemplateSaveInTransaction = false;

    expect(err.httpStatus).toBe(500);
    expect(idleInTransactionAtStorageCall.length).toBe(2);
    await expectUnchanged(before);
    expect(
      await selectMany(stack.db, templateResourcesTable, {
        tenantId: tenantAAdmin.tenantId,
        slug: "release-bundle",
      }),
    ).toHaveLength(0);
  });
});

describe("a failure inside the transaction releases the copied binaries", () => {
  test("copy-locale: a failing row write leaves no binary, no fileRef row and no template", async () => {
    const files = await createSystemTemplateWithFiles("copy-release");
    const before = await snapshot();

    failTemplateSaveInTransaction = true;
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.copyLocale,
      copyLocalePayload(files.slug),
      tenantAAdmin,
    );
    failTemplateSaveInTransaction = false;

    expect(err.httpStatus).toBe(500);
    await expectUnchanged(before);
    expect(
      await selectMany(stack.db, templateResourcesTable, {
        tenantId: tenantAAdmin.tenantId,
        slug: files.slug,
      }),
    ).toHaveLength(0);
  });
});

describe("callers", () => {
  test("a perCommand handler orchestrates resource-upload through ctx.write", async () => {
    const templateId = await createMailTemplate(tenantAAdmin, "orchestrated-upload");
    const sourceFileRefId = await uploadPng(tenantAAdmin);

    const result = await stack.http.writeOk<{ fileRefId: string }>(
      ORCHESTRATE_UPLOAD,
      { sourceFileRefId, templateId, key: "logo" },
      tenantAAdmin,
    );

    expect(await linkedResourcesOf(templateId, tenantAAdmin)).toEqual({
      logo: result.fileRefId,
    });
    const [row] = await selectMany<{ storageKey: string }>(stack.db, fileRefsTable, {
      id: result.fileRefId,
    });
    expect(provider.keys()).toContain(row?.storageKey ?? "");
  });

  test("a perCommand handler orchestrates import-bundle through ctx.write", async () => {
    await stack.http.writeOk(
      ORCHESTRATE_BUNDLE,
      { bundle: mailBundle("orchestrated-bundle") },
      tenantAAdmin,
    );

    const exported = await stack.http.queryOk<{ resources: Record<string, { fileName: string }> }>(
      TemplateResolverQueries.exportBundle,
      { slug: "orchestrated-bundle", kind: "mail" },
      tenantAAdmin,
    );
    expect(Object.keys(exported.resources).sort()).toEqual(["logo", "offer"]);
    expect(exported.resources["offer"]?.fileName).toBe("offer.pdf");
  });

  test("writeAs resource-upload stores the file in the switched-to tenant", async () => {
    const templateId = await createMailTemplate(tenantBAdmin, "switched-upload");
    const sourceFileRefId = await uploadPng(tenantBAdmin);

    const result = await stack.http.writeOk<{ fileRefId: string }>(
      SWITCH_UPLOAD,
      { sourceFileRefId, templateId, key: "logo" },
      tenantAAdmin,
    );

    expect(await linkedResourcesOf(templateId, tenantBAdmin)).toEqual({ logo: result.fileRefId });
    const [row] = await selectMany<{ storageKey: string; tenantId: string }>(
      stack.db,
      fileRefsTable,
      { id: result.fileRefId },
    );
    expect(row?.tenantId).toBe(tenantBAdmin.tenantId);
    expect(row?.storageKey.startsWith(`${tenantBAdmin.tenantId}/`)).toBe(true);
    expect(provider.keys()).toContain(row?.storageKey ?? "");
  });

  test("writeAs import-bundle stores the resource files in the switched-to tenant", async () => {
    await stack.http.writeOk(
      SWITCH_BUNDLE,
      { bundle: mailBundle("switched-bundle") },
      tenantAAdmin,
    );

    const [template] = await selectMany<{ id: string }>(stack.db, templateResourcesTable, {
      tenantId: tenantBAdmin.tenantId,
      slug: "switched-bundle",
    });
    const linked = (await linkedResourcesOf(template?.id ?? "", tenantBAdmin)) as Record<
      string,
      { fileRefId?: string } | string
    >;
    expect(Object.keys(linked).sort()).toEqual(["logo", "offer"]);
    const fileRefs = await selectMany<{ tenantId: string; storageKey: string }>(
      stack.db,
      fileRefsTable,
      { tenantId: tenantBAdmin.tenantId },
    );
    expect(fileRefs.length).toBeGreaterThanOrEqual(2);
    expect(fileRefs.every((ref) => ref.storageKey.startsWith(`${tenantBAdmin.tenantId}/`))).toBe(
      true,
    );
    expect(
      await selectMany(stack.db, templateResourcesTable, {
        tenantId: tenantAAdmin.tenantId,
        slug: "switched-bundle",
      }),
    ).toHaveLength(0);
  });

  test("a normal handler cannot call resource-upload through a nested ctx.write", async () => {
    const templateId = await createMailTemplate(tenantAAdmin, "nested-upload");
    const sourceFileRefId = await uploadPng(tenantAAdmin);
    const before = await snapshot();

    const err = await stack.http.writeErr(
      NESTED_UPLOAD,
      { sourceFileRefId, templateId, key: "logo" },
      tenantAAdmin,
    );

    expect(err.httpStatus).toBe(500);
    expect(err.message).toContain("has a pre-transaction phase");
    await expectUnchanged(before);
  });

  test("a normal handler cannot call import-bundle through a nested ctx.write", async () => {
    const before = await snapshot();

    const err = await stack.http.writeErr(
      NESTED_BUNDLE,
      { bundle: mailBundle("nested-bundle") },
      tenantAAdmin,
    );

    expect(err.httpStatus).toBe(500);
    expect(err.message).toContain("has a pre-transaction phase");
    await expectUnchanged(before);
  });
});
