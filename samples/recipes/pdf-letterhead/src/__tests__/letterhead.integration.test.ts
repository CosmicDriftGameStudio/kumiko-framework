// A letterhead from layout to letter, through the real write pipeline over HTTP: the system layout
// carries its own look and company-data footer, the tenant's letter keeps its address frame, and
// apply-layout / publish-templates hand the layout to the letter.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY,
  TemplateResolverHandlers,
  TemplateResolverQueries,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature, userEntity } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createRendererPuppeteerClientFeature,
  RendererPuppeteerClientQueries,
  renderedPdfEntity,
} from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  LETTER_HTML,
  LETTER_LOCALE,
  LETTER_SLUG,
  LETTERHEAD_LAYOUT_HTML,
  LETTERHEAD_LAYOUT_META,
  LETTERHEAD_LAYOUT_SLUG,
  REBUILT_HEADER_BLOCKS,
  REBUILT_LAYOUT_NAME,
  REBUILT_LAYOUT_SLUG,
  REBUILT_LETTER_BLOCKS,
  REBUILT_LETTER_SLUG,
  TENANT_EDITABLE,
} from "../letterhead";

const admin = createTestUser({ id: 1, roles: ["TenantAdmin"], tenantId: testTenantId(1) });
const LETTER_REF = { slug: LETTER_SLUG, kind: "document-pdf", locale: LETTER_LOCALE } as const;

let stack: TestStack;
let letterId: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({ tenantEditable: [...TENANT_EDITABLE] }),
      createRendererFoundationFeature(),
      createRendererPuppeteerClientFeature(),
    ],
    files: { storageProvider: createInMemoryFileProvider() },
    extraContext: ({ registry }) => {
      const resolver = createConfigResolver();
      return {
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      };
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafeCreateEntityTable(stack.db, renderedPdfEntity, "rendered-pdf");
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: LETTERHEAD_LAYOUT_SLUG,
      kind: "pdf-layout",
      locale: LETTER_LOCALE,
      content: LETTERHEAD_LAYOUT_HTML,
      contentFormat: "html",
      meta: LETTERHEAD_LAYOUT_META,
      variableSchema: {},
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
  const stored = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertTenant,
    {
      ...LETTER_REF,
      content: LETTER_HTML,
      contentFormat: "html",
      status: "active",
      variableSchema: { recipientName: { type: "text" } },
    },
    admin,
  );
  letterId = stored.id;
});

afterAll(async () => {
  await stack.cleanup();
});

describe("pdf-letterhead", () => {
  test("the letter keeps its address frame and text style as written", async () => {
    const letter = await stack.http.queryOk<{ content: string }>(
      TemplateResolverQueries.findById,
      { id: letterId },
      admin,
    );
    expect(letter.content).toContain('data-frame-preset="address"');
    expect(letter.content).toContain('data-size-pt="14"');
  });

  test("the footer asks for company data the tenant has not entered", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:company-iban", value: "DE89 3704 0044 0532 0130 00" },
      admin,
    );
    const result = await stack.http.queryOk<{ emptyCompanyData: string[] }>(
      TemplateResolverQueries.validate,
      {
        ...LETTER_REF,
        content: LETTERHEAD_LAYOUT_HTML,
        contentFormat: "html",
        meta: {},
      },
      admin,
    );
    expect(result.emptyCompanyData).toContain("companyBic");
    expect(result.emptyCompanyData).not.toContain("companyIban");
  });

  test("apply-layout hands the layout to the letter, publish-templates activates it", async () => {
    const applied = await stack.http.writeOk<{ applied: { slug: string }[]; skipped: unknown[] }>(
      TemplateResolverHandlers.applyLayout,
      {
        layoutSlug: LETTERHEAD_LAYOUT_SLUG,
        target: { mode: "selected", templates: [{ slug: LETTER_SLUG, locale: LETTER_LOCALE }] },
      },
      admin,
    );
    expect(applied.applied.map((entry) => entry.slug)).toEqual([LETTER_SLUG]);
    expect(applied.skipped).toEqual([]);

    const published = await stack.http.writeOk<{
      published: { slug: string }[];
      failed: unknown[];
    }>(TemplateResolverHandlers.publishTemplates, { templates: [LETTER_REF] }, admin);
    expect(published.published.map((entry) => entry.slug)).toEqual([LETTER_SLUG]);

    const usage = await stack.http.queryOk<{
      usedByTemplates: { slug: string; hasOwnLayout: boolean }[];
    }>(TemplateResolverQueries.usage, { slug: LETTERHEAD_LAYOUT_SLUG, kind: "pdf-layout" }, admin);
    expect(usage.usedByTemplates).toMatchObject([{ slug: LETTER_SLUG, hasOwnLayout: true }]);
  });

  test("mode all makes the layout the tenant default without touching the letter", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: LETTERHEAD_LAYOUT_SLUG, target: { mode: "all" } },
      admin,
    );
    const values = await stack.http.queryOk<Record<string, { value?: unknown }>>(
      "config:query:values",
      { keys: [DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY] },
      admin,
    );
    expect(values[DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY]?.value).toBe(LETTERHEAD_LAYOUT_SLUG);
  });

  test("create-layout and patch-draft rebuild a letterhead and a letter from structured blocks", async () => {
    type Blocks = {
      base: { scope: string; version: number };
      blocks: { type: string; text?: string; each?: string }[];
    };
    const layout = await stack.http.writeOk<{ base: Blocks["base"] }>(
      TemplateResolverHandlers.createLayout,
      { name: REBUILT_LAYOUT_NAME, title: "Briefkopf Musterfirma", locale: LETTER_LOCALE },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: REBUILT_LAYOUT_SLUG,
        kind: "pdf-layout",
        region: "header",
        locale: LETTER_LOCALE,
        base: layout.base,
        ops: [{ op: "replaceBody", blocks: REBUILT_HEADER_BLOCKS }],
      },
      admin,
    );
    const header = await stack.http.queryOk<Blocks>(
      TemplateResolverQueries.documentBlocks,
      { slug: REBUILT_LAYOUT_SLUG, kind: "pdf-layout", region: "header", locale: LETTER_LOCALE },
      admin,
    );
    expect(header.blocks.map((block) => block.text)).toEqual([
      "Musterfirma GmbH",
      "Musterstraße 1, 12345 Musterstadt",
    ]);

    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: REBUILT_LETTER_SLUG,
        kind: "document-pdf",
        locale: LETTER_LOCALE,
        content: "<p>Platzhalter</p>",
        contentFormat: "html",
        variableSchema: {
          invoiceNumber: { type: "text" },
          positions: { type: "list", item: { label: { type: "text" }, amount: { type: "text" } } },
        },
      },
      admin,
    );
    const letterRef = { slug: REBUILT_LETTER_SLUG, kind: "document-pdf", locale: LETTER_LOCALE };
    const before = await stack.http.queryOk<Blocks>(
      TemplateResolverQueries.documentBlocks,
      letterRef,
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        ...letterRef,
        base: before.base,
        ops: [
          { op: "replaceBody", blocks: REBUILT_LETTER_BLOCKS },
          { op: "setMeta", meta: { layoutSlug: REBUILT_LAYOUT_SLUG } },
        ],
      },
      admin,
    );
    const after = await stack.http.queryOk<Blocks & { meta: Record<string, unknown> }>(
      TemplateResolverQueries.documentBlocks,
      letterRef,
      admin,
    );
    expect(after.blocks.map((block) => block.type)).toEqual(["frame", "heading", "repeat"]);
    expect(after.blocks[0]?.text).toBe("Max Mustermann\nBeispielweg 2");
    expect(after.meta["layoutSlug"]).toBe(REBUILT_LAYOUT_SLUG);
  });
});

describe("pdf-letterhead preview-png", () => {
  const SERVICE_TOKEN = "recipe-service-token-0123456789abcdef";
  const ONE_PIXEL_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
  const renderedHtml: string[] = [];
  const envKeys = ["PUPPETEER_SERVICE_URL", "PUPPETEER_AUTH_TOKEN", "PUPPETEER_CLIENT_MAX_RETRIES"];
  const savedEnv = new Map<string, string | undefined>();

  // Stands in for puppeteer-service so the recipe runs without Chromium or poppler.
  const service = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.headers.get("Authorization") !== `Bearer ${SERVICE_TOKEN}`) {
        return new Response("unauthorized", { status: 401 });
      }
      if (pathname === "/render") {
        renderedHtml.push(JSON.stringify(await request.json()));
        return new Response("%PDF-1.4\n1 0 obj<< /Type /Pages /Kids [] /Count 1 >>endobj\n%%EOF", {
          headers: { "Content-Type": "application/pdf" },
        });
      }
      if (pathname === "/rasterize") {
        const page = { mimeType: "image/png", data: ONE_PIXEL_PNG, widthPx: 1, heightPx: 1 };
        return Response.json({ pages: [page], images: [] });
      }
      return new Response("not found", { status: 404 });
    },
  });

  beforeAll(() => {
    for (const key of envKeys) savedEnv.set(key, process.env[key]);
    process.env["PUPPETEER_SERVICE_URL"] = `http://127.0.0.1:${service.port}`;
    process.env["PUPPETEER_AUTH_TOKEN"] = SERVICE_TOKEN;
    process.env["PUPPETEER_CLIENT_MAX_RETRIES"] = "0";
  });

  afterAll(async () => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await service.stop(true);
  });

  test("the rebuilt letterhead is printed and comes back as a PNG page the agent can look at", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.publishTemplates,
      { templates: [{ slug: REBUILT_LAYOUT_SLUG, kind: "pdf-layout", locale: LETTER_LOCALE }] },
      admin,
    );
    const preview = await stack.http.queryOk<{
      pages: { mimeType: string; data: string }[];
      agentImages: { mimeType: string; data: string }[];
    }>(
      RendererPuppeteerClientQueries.previewPng,
      {
        slug: REBUILT_LETTER_SLUG,
        locale: LETTER_LOCALE,
        content: "<p>Sehr geehrte Damen und Herren</p>",
        meta: { layoutSlug: REBUILT_LAYOUT_SLUG },
      },
      admin,
    );

    expect(renderedHtml.join("")).toContain("Musterfirma GmbH");
    expect(preview.pages).toHaveLength(1);
    expect(preview.agentImages).toHaveLength(1);
    const bytes = Buffer.from(preview.agentImages[0]?.data ?? "", "base64");
    expect([...bytes.subarray(0, 4)]).toEqual(PNG_MAGIC);
  });
});
