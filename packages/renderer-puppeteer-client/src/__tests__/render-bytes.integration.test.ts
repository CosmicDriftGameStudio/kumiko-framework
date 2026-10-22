// renderPdfBytes is the render-only half: the bytes reach the handler, but no file or rendered-pdf row exists.

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  TemplateResolverHandlers,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { renderedPdfEntity, renderedPdfsTable } from "../entity";
import { createRendererPuppeteerClientFeature } from "../feature";
import { renderPdfBytes } from "../render-and-store";

const FEATURE = "render-bytes-pdf";
const RENDER_ONLY = `${FEATURE}:write:render-only`;
const SERVICE_TOKEN = "render-bytes-test-service-token";
const STUB_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<< /Type /Pages /Kids [] /Count 1 >>endobj\n%%EOF",
);

const stubService = Bun.serve({
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (
      pathname !== "/render" ||
      request.headers.get("Authorization") !== `Bearer ${SERVICE_TOKEN}`
    ) {
      return new Response("unauthorized", { status: 401 });
    }
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

const pdfFeature = defineFeature(FEATURE, (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "render-only",
      schema: z.object({ number: z.string() }),
      access: { roles: ["TenantAdmin"] },
      beforeTransaction: (event, ctx) =>
        renderPdfBytes(ctx, {
          slug: "note",
          locale: "de",
          variables: { number: event.payload.number },
        }),
      handler: async (event) => ({
        isSuccess: true as const,
        data: { fileName: event.prepared.fileName, size: event.prepared.pdfBytes.length },
      }),
    }),
  );
});

const provider = createInMemoryFileProvider();
let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createConfigFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererPuppeteerClientFeature(),
      pdfFeature,
    ],
    files: { storageProvider: provider },
    extraContext: (deps) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await unsafeCreateEntityTable(stack.db, renderedPdfEntity, "rendered-pdf");
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: "note",
      kind: "document-pdf",
      locale: "de",
      content: '<h1>Notiz <span data-variable="number"></span></h1>',
      contentFormat: "html",
      meta: { pageFormat: "A4", fileName: "Notiz-{{number}}.pdf" },
      variableSchema: { number: { type: "text" } },
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
  await stubService.stop(true);
});

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env["PUPPETEER_SERVICE_URL"] = STUB_URL;
  process.env["PUPPETEER_AUTH_TOKEN"] = SERVICE_TOKEN;
  process.env["PUPPETEER_CLIENT_MAX_RETRIES"] = "0";
  provider.clear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

test("renderPdfBytes returns the rendered bytes and writes no row and no file", async () => {
  const admin = createTestUser({ id: 9605, roles: ["TenantAdmin"], tenantId: testTenantId(9605) });

  const result = await stack.http.writeOk<{ fileName: string; size: number }>(
    RENDER_ONLY,
    { number: "R-1" },
    admin,
  );

  expect(result).toEqual({ fileName: "Notiz-R-1.pdf", size: STUB_PDF.length });
  expect(await selectMany(stack.db, renderedPdfsTable, { tenantId: admin.tenantId })).toHaveLength(
    0,
  );
  expect(await selectMany(stack.db, fileRefsTable, { tenantId: admin.tenantId })).toHaveLength(0);
  expect(provider.keys().filter((key) => key.startsWith(`${admin.tenantId}/`))).toEqual([]);
});
