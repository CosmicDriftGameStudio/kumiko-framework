// Rendering with `variant` goes through the real resolver and the real HTTP write pipeline; only the print service is a stub.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
import { renderPdfBeforeTransaction, storeRenderedPdf } from "../render-and-store";

const FEATURE = "variant-pdf";
const GENERATE = `${FEATURE}:write:generate`;
const SERVICE_TOKEN = "variant-test-service-token";
const STUB_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<< /Type /Pages /Kids [] /Count 1 >>endobj\n%%EOF",
);
const BASE = "agreement";
const OWN_VARIANT = `${BASE}:short`;
const SYSTEM_VARIANT = `${BASE}:long`;
const FOREIGN_BASE_VARIANT = "other-agreement:short";

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

const ENV_KEYS = ["PUPPETEER_SERVICE_URL", "PUPPETEER_AUTH_TOKEN"] as const;
const savedEnv = new Map<string, string | undefined>();

const pdfFeature = defineFeature(FEATURE, (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "generate",
      schema: z.object({ variant: z.string().optional() }),
      access: { roles: ["TenantAdmin"] },
      beforeTransaction: (event, ctx) =>
        renderPdfBeforeTransaction(ctx, {
          slug: BASE,
          ...(event.payload.variant !== undefined && { variant: event.payload.variant }),
          locale: "de",
          variables: { name: "Anna" },
        }),
      handler: (event, ctx) => storeRenderedPdf(ctx, event.prepared),
    }),
  );
});

const admin = createTestUser({ id: 9701, roles: ["TenantAdmin"], tenantId: testTenantId(9701) });
const otherAdmin = createTestUser({
  id: 9702,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(9702),
});
const provider = createInMemoryFileProvider();
let stack: TestStack;

const documentPayload = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  kind: "document-pdf" as const,
  locale: "de",
  content: '<p>Hallo <span data-variable="name"></span></p>',
  contentFormat: "html" as const,
  variableSchema: { name: { type: "text" } },
  ...extra,
});

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createConfigFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({
        tenantEditable: [
          {
            kind: "document-pdf",
            slug: BASE,
            access: { roles: ["TenantAdmin"] },
            variants: true,
          },
        ],
      }),
      createRendererFoundationFeature(),
      createRendererPuppeteerClientFeature(),
      pdfFeature,
    ],
    files: { storageProvider: provider },
    extraContext: (deps) => ({
      configResolver: resolver,
      configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await unsafeCreateEntityTable(stack.db, renderedPdfEntity, "rendered-pdf");
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  const system = (payload: Record<string, unknown>) =>
    stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...payload, linkedResources: {} },
      TestUsers.systemAdmin,
    );
  await system(documentPayload(BASE));
  await system(documentPayload(SYSTEM_VARIANT, { meta: { variantOf: BASE } }));
  await system(documentPayload(FOREIGN_BASE_VARIANT, { meta: { variantOf: "other-agreement" } }));
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    documentPayload(OWN_VARIANT, { meta: { variantOf: BASE }, status: "active" }),
    admin,
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
  provider.clear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

const storedSlugs = async (tenantId: string) =>
  (await selectMany(stack.db, renderedPdfsTable, { tenantId })).map((row) =>
    String(Reflect.get(row, "templateSlug")),
  );

describe("renderPdfBeforeTransaction with variant", () => {
  test("without variant the base renders, with variant the variant does", async () => {
    await stack.http.writeOk(GENERATE, {}, admin);
    await stack.http.writeOk(GENERATE, { variant: OWN_VARIANT }, admin);
    await stack.http.writeOk(GENERATE, { variant: SYSTEM_VARIANT }, admin);
    expect((await storedSlugs(admin.tenantId)).sort()).toEqual(
      [BASE, OWN_VARIANT, SYSTEM_VARIANT].sort(),
    );
  });

  test("a variant of another base, an unknown slug and another tenant's variant fail with template_variant_unknown", async () => {
    for (const [variant, user] of [
      [FOREIGN_BASE_VARIANT, admin],
      [`${BASE}:missing`, admin],
      [BASE, admin],
      [OWN_VARIANT, otherAdmin],
    ] as const) {
      const error = await stack.http.writeErr(GENERATE, { variant }, user);
      expect({ variant, status: error.httpStatus, details: error.details }).toEqual({
        variant,
        status: 422,
        details: { reason: "template_variant_unknown" },
      });
    }
    expect(await storedSlugs(otherAdmin.tenantId)).toEqual([]);
  });
});
