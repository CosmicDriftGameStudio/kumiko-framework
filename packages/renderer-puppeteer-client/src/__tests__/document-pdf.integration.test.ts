// End to end through the real stack: system templates are stored through the real handlers,
// the PDF service is a local stub (Chromium is not available in CI), calls are real HTTP requests.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  SYSTEM_TENANT_ID,
  TemplateResolverHandlers,
  TemplateResolverQueries,
  templateResourceEntity,
  templateResourcesTable,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  QnTypes,
  qn,
} from "@cosmicdrift/kumiko-framework/engine";
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
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import * as z from "zod";
import { renderedPdfEntity, renderedPdfsTable } from "../entity";
import { createRendererPuppeteerClientFeature } from "../feature";
import { RendererPuppeteerClientQueries } from "../qualified-names";
import { renderPdfBeforeTransaction, storeRenderedPdf } from "../render-and-store";

const FEATURE = "invoice-pdf";
const GENERATE = qn(FEATURE, QnTypes.write, "generate");
const MAIL = qn(FEATURE, QnTypes.notify, "invoice");
const SEND_MAIL = qn(FEATURE, QnTypes.write, "send-mail");

const AUTH_TOKEN = "stub-token-0123456789abcdef";
const STUB_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<< /Type /Pages /Kids [] /Count 2 >>endobj\n%%EOF",
);
const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

type StubRequest = {
  readonly kind: string;
  readonly html: string;
  readonly options: {
    readonly format?: string;
    readonly displayHeaderFooter?: boolean;
    readonly landscape?: boolean;
    readonly printBackground?: boolean;
    readonly headerTemplate?: string;
    readonly footerTemplate?: string;
    readonly marginMm?: {
      readonly top: number;
      readonly bottom: number;
      readonly left: number;
    };
  };
};

const stubRequests: StubRequest[] = [];
const stubService = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return new Response("ok");
    if (pathname !== "/render" || request.headers.get("Authorization") !== `Bearer ${AUTH_TOKEN}`) {
      return new Response("unauthorized", { status: 401 });
    }
    stubRequests.push((await request.json()) as StubRequest);
    return new Response(STUB_PDF, { headers: { "Content-Type": "application/pdf" } });
  },
});
const STUB_URL = `http://127.0.0.1:${stubService.port}`;

const ENV_KEYS = [
  "PUPPETEER_SERVICE_URL",
  "PUPPETEER_AUTH_TOKEN",
  "PUPPETEER_CLIENT_MAX_RETRIES",
] as const;
const savedEnv = new Map<string, string | undefined>();

function pointClientAt(url: string): void {
  process.env["PUPPETEER_SERVICE_URL"] = url;
  process.env["PUPPETEER_AUTH_TOKEN"] = AUTH_TOKEN;
  process.env["PUPPETEER_CLIENT_MAX_RETRIES"] = "0";
}

const ITEMS = [
  { description: "Beratung", amount: 120000 },
  { description: "Reise", amount: 4550 },
  { description: "Material", amount: 99 },
];

const invoiceFeature = defineFeature(FEATURE, (r) => {
  r.requires("delivery");
  r.notification("invoice", {
    variables: {},
    localizedTemplate: () => ({
      de: {
        body: "<p>Rechnung</p>",
        meta: { subject: "Rechnung", category: "transactional" as const },
      },
    }),
  });
  r.writeHandler(
    defineWriteHandler({
      name: "generate",
      schema: z.object({ number: z.string(), description: z.string().optional() }),
      access: { roles: ["TenantAdmin"] },
      beforeTransaction: async (event, ctx) =>
        renderPdfBeforeTransaction(ctx, {
          slug: "invoice",
          locale: "de",
          variables: {
            number: event.payload.number,
            items:
              event.payload.description === undefined
                ? ITEMS
                : [{ description: event.payload.description, amount: 100 }],
          },
        }),
      handler: async (event, ctx) => storeRenderedPdf(ctx, event.prepared),
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "send-mail",
      schema: z.object({ number: z.string() }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        if (!ctx.notify) throw new Error("notify is not wired");
        await ctx.notify(MAIL, {
          route: { email: "customer@example.com" },
          data: {
            attachments: [
              {
                kind: "rendered-pdf",
                templateSlug: "invoice",
                variables: { number: event.payload.number, items: ITEMS },
                fileName: `Rechnung-${event.payload.number}.pdf`,
                locale: "de",
              },
            ],
          },
        });
        return { isSuccess: true as const, data: {} };
      },
    }),
  );
});

const tenantAdmin = (id: number) =>
  createTestUser({ id, roles: ["TenantAdmin"], tenantId: testTenantId(id) });
const adminTenantA = tenantAdmin(41);
const adminTenantB = tenantAdmin(42);
const adminTenantC = tenantAdmin(43);
const adminTenantD = tenantAdmin(44);

const transport = createInMemoryTransport();
const provider = createInMemoryFileProvider();
let stack: TestStack;
let invoiceTemplateId: string;
let layoutTemplateId: string;

const INVOICE_BODY = [
  '<h1>Rechnung <span data-variable="number"></span></h1>',
  '<table><tbody><tr data-repeat-header=""><th><p>Position</p></th><th><p>Betrag</p></th></tr>',
  '<tr data-each="items"><td><p><span data-variable="description"></span></p></td><td><p><span data-variable="amount"></span></p></td></tr></tbody></table>',
  '<div data-page-break=""></div>',
  "<p>Zahlbar innerhalb von 14 Tagen.</p>",
].join("");

const LAYOUT_BODY = [
  '<div data-header><p>Briefkopf Test GmbH</p><img data-resource="logo" alt="Logo"></div>',
  "<div data-content></div>",
  '<div data-footer><p>Seite <span data-variable="page"></span> von <span data-variable="pages"></span></p></div>',
].join("");

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createConfigFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createRendererPuppeteerClientFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport,
        resolveEmail: async () => "unused@test.local",
      }),
      invoiceFeature,
    ],
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker" },
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await unsafeCreateEntityTable(stack.db, renderedPdfEntity, "rendered-pdf");
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await seedNotificationTemplates(stack.db, stack.registry);

  const layout = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: "letterhead",
      kind: "pdf-layout",
      locale: "de",
      content: LAYOUT_BODY,
      contentFormat: "html",
      meta: {},
      variableSchema: {},
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
  layoutTemplateId = layout.id;
  const invoice = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: "invoice",
      kind: "document-pdf",
      locale: "de",
      content: INVOICE_BODY,
      contentFormat: "html",
      meta: {
        layoutSlug: "letterhead",
        pageFormat: "A4",
        margins: { top: 35 },
        fileName: "Rechnung-{{number}}.pdf",
        metadata: { title: "Rechnung {{number}}" },
      },
      variableSchema: {
        number: { type: "text" },
        items: { type: "list", item: { description: { type: "text" }, amount: { type: "money" } } },
      },
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
  invoiceTemplateId = invoice.id;
  await uploadImageFor(layoutTemplateId, "logo");
});

afterAll(async () => {
  await stack.cleanup();
  await stubService.stop(true);
});

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  pointClientAt(STUB_URL);
  stubRequests.length = 0;
  transport.sent.length = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

async function uploadImageFor(
  templateId: string,
  key: string,
  user: typeof TestUsers.systemAdmin = TestUsers.systemAdmin,
): Promise<void> {
  const token = await stack.jwt.sign(user);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(PNG_BYTES)], "logo.png", { type: "image/png" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const { id: sourceFileRefId } = (await res.json()) as { id: string };
  await stack.http.writeOk(
    TemplateResolverHandlers.resourceUpload,
    {
      sourceFileRefId,
      templateId,
      key,
      ...(user === TestUsers.systemAdmin ? { tenantIdOverride: SYSTEM_TENANT_ID } : {}),
    },
    user,
  );
}

type Generated = {
  renderedPdfId: string;
  fileRefId: string;
  fileName: string;
  pageCount: number;
};

function onlyStubRequest(): StubRequest {
  expect(stubRequests).toHaveLength(1);
  const [request] = stubRequests;
  if (request === undefined) throw new Error("no request reached the stub");
  return request;
}

describe("document-pdf through renderPdfBeforeTransaction and storeRenderedPdf", () => {
  test("an invoice is rendered from the stored template and layout and stored with provenance", async () => {
    const result = await stack.http.writeOk<Generated>(GENERATE, { number: "R-1" }, adminTenantA);

    const request = onlyStubRequest();
    expect(request.kind).toBe("document-pdf");
    expect(request.html).toContain("<title>Rechnung R-1</title>");
    expect(request.html).toMatch(
      /<thead><tr>\s*<th><p>Position<\/p><\/th><th><p>Betrag<\/p><\/th><\/tr><\/thead>/,
    );
    for (const item of ITEMS) expect(request.html).toContain(item.description);
    expect(request.html).toContain("1.200,00");
    expect(request.html).toContain("45,50");
    expect(request.html).toContain("0,99");
    expect(request.html).toContain("data-page-break");
    expect(request.html).not.toContain("https://");
    expect(request.options.displayHeaderFooter).toBe(true);
    expect(request.options.format).toBe("A4");
    expect(request.options.marginMm?.top).toBe(35);
    expect(request.options.headerTemplate).toContain("data:image/png;base64,");
    expect(request.options.headerTemplate).toContain("Briefkopf Test GmbH");
    expect(request.options.footerTemplate).toContain('class="pageNumber"');
    expect(request.options.footerTemplate).toContain('class="totalPages"');

    expect(result.fileName).toBe("Rechnung-R-1.pdf");
    expect(result.pageCount).toBe(2);

    const [fileRef] = await selectMany<{ mimeType: string; storageKey: string; tenantId: string }>(
      stack.db,
      fileRefsTable,
      { id: result.fileRefId },
    );
    expect(fileRef?.mimeType).toBe("application/pdf");
    expect(fileRef?.tenantId).toBe(adminTenantA.tenantId);
    expect(Buffer.from(await provider.read(fileRef?.storageKey ?? ""))).toEqual(
      Buffer.from(STUB_PDF),
    );

    const [record] = await selectMany<{
      templateSlug: string;
      templateId: string;
      templateVersion: number;
      templateScope: string;
      layoutId: string;
      layoutVersion: number;
      fileRefId: string;
    }>(stack.db, renderedPdfsTable, { id: result.renderedPdfId });
    expect(record).toMatchObject({
      templateSlug: "invoice",
      templateId: invoiceTemplateId,
      templateScope: "system",
      layoutId: layoutTemplateId,
      fileRefId: result.fileRefId,
    });
    expect(record?.templateVersion).toBeGreaterThanOrEqual(1);
    expect(record?.layoutVersion).toBeGreaterThanOrEqual(1);
  });

  test("a tenant layout that fails the sanitizer is replaced by the system layout", async () => {
    const created = await createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
      entityName: "template-resource",
    }).create(
      {
        tenantId: adminTenantB.tenantId,
        slug: "letterhead",
        kind: "pdf-layout",
        locale: "de",
        content:
          '<div data-header><a href="javascript:alert(1)">x</a><p>TENANT_HEADER_MARKER</p></div><div data-content></div><div data-footer><p>f</p></div>',
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: "{}",
        scope: "tenant",
        parentTemplateId: null,
        status: "active",
      },
      adminTenantB,
      createTenantDb(stack.db, adminTenantB.tenantId, "system"),
    );
    expect(created.isSuccess).toBe(true);

    await stack.http.writeOk(GENERATE, { number: "R-2" }, adminTenantB);

    const request = onlyStubRequest();
    expect(request.options.headerTemplate).not.toContain("TENANT_HEADER_MARKER");
    expect(request.options.headerTemplate).not.toContain("javascript:");
    expect(request.options.headerTemplate).toContain("Briefkopf Test GmbH");
  });

  test("a variable value with an external image url is escaped and loads nothing", async () => {
    await stack.http.writeOk(
      GENERATE,
      { number: "R-3", description: '<img src="https://evil.example/x.png">' },
      adminTenantC,
    );

    const { html } = onlyStubRequest();
    expect(html).toContain("&lt;img src=");
    expect(html).not.toContain('<img src="https://evil.example');
    expect(html).not.toMatch(/<img[^>]+https:\/\//);
  });

  test("with the service down the handler answers 503 puppeteer_unavailable and stores nothing", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const closedUrl = `http://127.0.0.1:${closed.port}`;
    await closed.stop(true);
    pointClientAt(closedUrl);
    const before = await selectMany(stack.db, renderedPdfsTable, {});

    const error = await stack.http.writeErr(GENERATE, { number: "R-4" }, adminTenantD);

    expect(error.code).toBe("puppeteer_unavailable");
    expect(error.httpStatus).toBe(503);
    const wire = JSON.stringify(error);
    expect(wire).not.toContain(closedUrl.replace("http://", ""));
    expect(wire).not.toContain("ECONNREFUSED");
    expect(await selectMany(stack.db, renderedPdfsTable, {})).toHaveLength(before.length);
  });

  test("the status query reports whether the service answers", async () => {
    const up = await stack.http.queryOk<{ available: boolean }>(
      RendererPuppeteerClientQueries.status,
      {},
      adminTenantA,
    );
    expect(up).toEqual({ available: true });

    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const closedUrl = `http://127.0.0.1:${closed.port}`;
    await closed.stop(true);
    pointClientAt(closedUrl);
    const down = await stack.http.queryOk<{ available: boolean; error?: string }>(
      RendererPuppeteerClientQueries.status,
      {},
      adminTenantA,
    );
    expect(down).toMatchObject({ available: false, error: "puppeteer_unavailable" });
    expect(JSON.stringify(down)).not.toContain(closedUrl.replace("http://", ""));
    expect(JSON.stringify(down)).not.toContain("ECONNREFUSED");
  });
});

describe("rendered-pdf mail attachment", () => {
  test("the PDF is rendered in the send job and arrives as an attachment", async () => {
    await stack.http.writeOk(SEND_MAIL, { number: "R-1" }, adminTenantA);
    expect(stubRequests).toHaveLength(0);

    await stack.drainJobs();

    expect(stubRequests).toHaveLength(1);
    const mail = transport.sent.at(-1);
    if (mail === undefined) throw new Error("no mail was sent");
    const pdf = mail.attachments?.find((a) => a.kind === "rendered-pdf");
    expect(pdf).toMatchObject({
      fileName: "Rechnung-R-1.pdf",
      contentType: "application/pdf",
    });
    expect(Buffer.from(pdf?.content ?? [])).toEqual(Buffer.from(STUB_PDF));
  });
});

type PdfPreview = {
  fileName: string;
  pdfBase64: string;
  pageCount: number;
  sizeBytes: number;
  durationMs: number;
};

const draftPayload = (overrides: Record<string, unknown> = {}) => ({
  slug: "invoice",
  locale: "de",
  content: '<p>ENTWURF <span data-variable="number"></span></p>',
  meta: { layoutSlug: "letterhead", fileName: "Entwurf-{{number}}.pdf" },
  variableSchema: { number: { type: "text", example: "R-77" } },
  ...overrides,
});

describe("preview-pdf", () => {
  test("prints the unsaved draft with sample values, not the stored template", async () => {
    const preview = await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload(),
      adminTenantA,
    );

    const request = onlyStubRequest();
    expect(request.html).toContain("ENTWURF R-77");
    expect(request.html).not.toContain("Zahlbar innerhalb von 14 Tagen");
    expect(request.options.headerTemplate).toContain("Briefkopf Test GmbH");
    expect(preview.fileName).toBe("Entwurf-R-77.pdf");
    expect(preview.pageCount).toBe(2);
    expect(preview.sizeBytes).toBe(STUB_PDF.byteLength);
    expect(Buffer.from(preview.pdfBase64, "base64")).toEqual(Buffer.from(STUB_PDF));
    expect(preview.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("an image linked only by the caller's draft row is printed although no row is active", async () => {
    const adminTenantE = tenantAdmin(45);
    const draftRow = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: "invoice",
        kind: "document-pdf",
        locale: "de",
        content: "<p>Gespeicherter Entwurf</p>",
        contentFormat: "html",
        meta: { layoutSlug: "letterhead" },
        variableSchema: {},
        linkedResources: {},
      },
      adminTenantE,
    );
    await uploadImageFor(draftRow.id, "photo", adminTenantE);

    await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({ content: '<p><img data-resource="photo" alt="Foto"></p>' }),
      adminTenantE,
    );

    expect(onlyStubRequest().html).toContain("data:image/png;base64,");
  });

  test("a SystemAdmin prints a draft whose image is linked only by the system row", async () => {
    const systemRow = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      {
        slug: "system-draft",
        kind: "document-pdf",
        locale: "de",
        content: "<p>Gespeicherter Systementwurf</p>",
        contentFormat: "html",
        meta: { layoutSlug: "letterhead" },
        variableSchema: {},
        linkedResources: {},
      },
      TestUsers.systemAdmin,
    );
    await uploadImageFor(systemRow.id, "photo");

    await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({
        slug: "system-draft",
        content: '<p><img data-resource="photo" alt="Foto"></p>',
      }),
      TestUsers.systemAdmin,
    );

    expect(onlyStubRequest().html).toContain("data:image/png;base64,");
  });

  test("orientation, background and layout header/footer end up in the service request", async () => {
    await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({
        meta: {
          layoutSlug: "letterhead",
          orientation: "landscape",
          printBackground: false,
          layoutHeaderFooter: false,
        },
      }),
      adminTenantA,
    );

    const { options } = onlyStubRequest();
    expect(options.landscape).toBe(true);
    expect(options.printBackground).toBe(false);
    expect(options.displayHeaderFooter).toBe(false);
    expect(options.headerTemplate).toBeUndefined();
    expect(options.footerTemplate).toBeUndefined();
  });

  test("a draft without those meta fields prints portrait with background and layout regions", async () => {
    await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload(),
      adminTenantA,
    );

    const { options } = onlyStubRequest();
    expect(options.landscape).toBeUndefined();
    expect(options.printBackground).toBe(true);
    expect(options.displayHeaderFooter).toBe(true);
  });

  test("a partly set margin keeps the layout header and footer fallbacks for the other sides", async () => {
    await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({ meta: { layoutSlug: "letterhead", margins: { left: 12 } } }),
      adminTenantA,
    );

    const { options } = onlyStubRequest();
    expect(options.marginMm?.left).toBe(12);
    expect(options.marginMm?.top).toBe(30);
    expect(options.marginMm?.bottom).toBe(20);
  });

  test("data-align reaches the printed html with its print css", async () => {
    await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({ content: '<p data-align="center">Mitte</p>', variableSchema: {} }),
      adminTenantA,
    );

    const { html } = onlyStubRequest();
    expect(html).toContain('<p data-align="center">Mitte</p>');
    expect(html).toContain("[data-align=center]{text-align:center}");
  });

  test("a steps block prints as a table with the stages up to the sample value filled", async () => {
    await stack.http.queryOk<PdfPreview>(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({
        content:
          '<div data-steps="stage"><span data-step="ordered">Bestellt</span><span data-step="shipped">Versandt</span><span data-step="delivered">Zugestellt</span></div>',
        variableSchema: { stage: { type: "text", example: "shipped" } },
      }),
      adminTenantA,
    );

    const { html } = onlyStubRequest();
    expect(html).toContain('<table role="presentation"');
    expect(html.match(/border-radius:2px;background-color:#1f5468/g)).toHaveLength(2);
    expect(html.match(/border-radius:2px;background-color:#ECEDEA/g)).toHaveLength(1);
    expect(html).toMatch(/font-weight:600">Versandt/);
    expect(html).not.toContain("stepIs");
  });

  test("a user without an admin role is refused and nothing is printed", async () => {
    const error = await stack.http.queryErr(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload(),
      TestUsers.user,
    );
    expect(error.httpStatus).toBe(403);
    expect(stubRequests).toHaveLength(0);
  });

  test("with the service down it answers 503 puppeteer_unavailable", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const closedUrl = `http://127.0.0.1:${closed.port}`;
    await closed.stop(true);
    pointClientAt(closedUrl);

    const error = await stack.http.queryErr(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload(),
      adminTenantA,
    );

    expect(error.code).toBe("puppeteer_unavailable");
    expect(error.httpStatus).toBe(503);
    expect(JSON.stringify(error)).not.toContain(closedUrl.replace("http://", ""));
  });

  test("a draft that breaks the document rules is a validation error and is not printed", async () => {
    const error = await stack.http.queryErr(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({ content: "<p>x</p><script>alert(1)</script>" }),
      adminTenantA,
    );
    expect(error.code).toBe("validation_error");
    expect(stubRequests).toHaveLength(0);
  });

  test("an invalid meta is a validation error", async () => {
    const error = await stack.http.queryErr(
      RendererPuppeteerClientQueries.previewPdf,
      draftPayload({ meta: { orientation: "diagonal" } }),
      adminTenantA,
    );
    expect(error.code).toBe("validation_error");
    expect(stubRequests).toHaveLength(0);
  });
});

type DocumentPreview = {
  kind: string;
  html: string;
  sampleValues: Record<string, unknown>;
  checks: { code: string; ok: boolean }[];
  layout: { slug: string; regions: { header: string; signature: string; footer: string } } | null;
  validation: unknown;
};

describe("document-pdf preview", () => {
  test("the stored template shows replaced placeholders and the layout regions without calling the service", async () => {
    const preview = await stack.http.queryOk<DocumentPreview>(
      TemplateResolverQueries.preview,
      { slug: "invoice", kind: "document-pdf", locale: "de" },
      adminTenantA,
    );

    expect(preview.kind).toBe("document-pdf");
    expect(preview.sampleValues["number"]).toBe("[number]");
    expect(preview.html).toContain("Rechnung [number]");
    expect(preview.html).not.toContain("data-variable");
    expect(preview.layout?.slug).toBe("letterhead");
    expect(preview.layout?.regions.header).toContain("Briefkopf Test GmbH");
    expect(preview.layout?.regions.footer).toContain("Seite");
    expect(preview.layout?.regions.footer).not.toContain("data-variable");
    const codes = preview.checks.map((check) => check.code);
    expect(codes).toContain("resources_resolved");
    expect(codes).toContain("required_placeholders");
    expect(stubRequests).toHaveLength(0);
  });

  test("an unsaved draft is previewed with its declared examples and nothing is stored", async () => {
    const preview = await stack.http.queryOk<DocumentPreview>(
      TemplateResolverQueries.preview,
      {
        slug: "invoice",
        kind: "document-pdf",
        locale: "de",
        content: '<p>ENTWURF <span data-variable="number"></span></p>',
        meta: { layoutSlug: "letterhead", pageFormat: "A4" },
        variableSchema: { number: { type: "text", example: "R-77" } },
      },
      adminTenantA,
    );

    expect(preview.html).toContain("ENTWURF R-77");
    expect(preview.layout?.regions.header).toContain("Briefkopf Test GmbH");
    expect(stubRequests).toHaveLength(0);

    const stored = await stack.http.queryOk<DocumentPreview>(
      TemplateResolverQueries.preview,
      { slug: "invoice", kind: "document-pdf", locale: "de" },
      adminTenantA,
    );
    expect(stored.html).not.toContain("ENTWURF");
  });

  test("the preview works while the print service is down", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const closedUrl = `http://127.0.0.1:${closed.port}`;
    await closed.stop(true);
    pointClientAt(closedUrl);

    const preview = await stack.http.queryOk<DocumentPreview>(
      TemplateResolverQueries.preview,
      { slug: "invoice", kind: "document-pdf", locale: "de" },
      adminTenantA,
    );
    expect(preview.html).toContain("Rechnung [number]");
  });
});
