// The print service call runs before the handler transaction: a slow service must not hold pool
// connections, and a failed or rolled-back write must leave neither rows nor bytes behind.

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
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
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
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { renderedPdfEntity, renderedPdfsTable } from "../entity";
import { createRendererPuppeteerClientFeature } from "../feature";
import { renderPdfBeforeTransaction, storeRenderedPdf } from "../render-and-store";

const FEATURE = "before-tx-pdf";
const GENERATE = `${FEATURE}:write:generate`;
const GENERATE_THEN_FAIL = `${FEATURE}:write:generate-then-fail`;
const PING = `${FEATURE}:write:ping`;
const POOL_MAX = 2;
const CONCURRENT_RENDERS = 3;

const SERVICE_TOKEN = "before-transaction-test-service-token";
const STUB_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<< /Type /Pages /Kids [] /Count 1 >>endobj\n%%EOF",
);

type StubMode = "hold" | "unavailable";
let stubMode: StubMode = "hold";
let stubReceived = 0;
const heldRequests: Array<() => void> = [];

const stubService = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (
      pathname !== "/render" ||
      request.headers.get("Authorization") !== `Bearer ${SERVICE_TOKEN}`
    ) {
      return new Response("unauthorized", { status: 401 });
    }
    stubReceived += 1;
    if (stubMode === "unavailable") return new Response("down", { status: 503 });
    await new Promise<void>((release) => heldRequests.push(release));
    return new Response(STUB_PDF, { headers: { "Content-Type": "application/pdf" } });
  },
});
const STUB_URL = `http://127.0.0.1:${stubService.port}`;

function releaseHeldRequests(): void {
  for (const release of heldRequests.splice(0)) release();
}

const ENV_KEYS = [
  "PUPPETEER_SERVICE_URL",
  "PUPPETEER_AUTH_TOKEN",
  "PUPPETEER_CLIENT_MAX_RETRIES",
] as const;
const savedEnv = new Map<string, string | undefined>();

const renderArgs = (number: string) => ({
  slug: "note",
  locale: "de",
  variables: { number },
});

const pdfFeature = defineFeature(FEATURE, (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "generate",
      schema: z.object({ number: z.string() }),
      access: { roles: ["TenantAdmin"] },
      beforeTransaction: (event, ctx) =>
        renderPdfBeforeTransaction(ctx, renderArgs(event.payload.number)),
      handler: (event, ctx) => storeRenderedPdf(ctx, event.prepared),
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "generate-then-fail",
      schema: z.object({ number: z.string() }),
      access: { roles: ["TenantAdmin"] },
      beforeTransaction: (event, ctx) =>
        renderPdfBeforeTransaction(ctx, renderArgs(event.payload.number)),
      handler: async (event, ctx) => {
        const stored = await storeRenderedPdf(ctx, event.prepared);
        if (!stored.isSuccess) return stored;
        return writeFailure(new UnprocessableError("forced_rollback"));
      },
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({}),
      access: { roles: ["TenantAdmin"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    }),
  );
});

const tenantAdmin = (id: number) =>
  createTestUser({ id, roles: ["TenantAdmin"], tenantId: testTenantId(id) });

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
    dbPoolMax: POOL_MAX,
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
  releaseHeldRequests();
  await stack.cleanup();
  await stubService.stop(true);
});

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env["PUPPETEER_SERVICE_URL"] = STUB_URL;
  process.env["PUPPETEER_AUTH_TOKEN"] = SERVICE_TOKEN;
  process.env["PUPPETEER_CLIENT_MAX_RETRIES"] = "0";
  stubMode = "hold";
  stubReceived = 0;
  provider.clear();
});

afterEach(() => {
  releaseHeldRequests();
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

async function countIdleInTransaction(): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe<{ count: string }>(
    `select count(*) as count from pg_stat_activity
       where datname = current_database() and state like 'idle in transaction%'`,
  );
  return Number(rows[0]?.count ?? "-1");
}

describe("renderPdfBeforeTransaction", () => {
  test("a slow print service holds no connection: more renders than pool slots all reach it", async () => {
    const admin = tenantAdmin(9601);
    const renders = Array.from({ length: CONCURRENT_RENDERS }, (_, index) =>
      stack.http.write(GENERATE, { number: `P-${index}` }, admin),
    );

    await waitFor(() => stubReceived === CONCURRENT_RENDERS);

    expect(await countIdleInTransaction()).toBe(0);
    await stack.http.writeOk(PING, {}, admin);

    releaseHeldRequests();
    const responses = await Promise.all(renders);
    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: CONCURRENT_RENDERS }, () => 200),
    );
    const rows = await selectMany(stack.db, renderedPdfsTable, { tenantId: admin.tenantId });
    expect(rows).toHaveLength(CONCURRENT_RENDERS);
  });

  test("a print service answering 503 yields puppeteer_unavailable and stores nothing", async () => {
    stubMode = "unavailable";
    const admin = tenantAdmin(9602);

    const error = await stack.http.writeErr(GENERATE, { number: "F-1" }, admin);

    expect(error.code).toBe("puppeteer_unavailable");
    expect(error.httpStatus).toBe(503);
    expect(
      await selectMany(stack.db, renderedPdfsTable, { tenantId: admin.tenantId }),
    ).toHaveLength(0);
    expect(await selectMany(stack.db, fileRefsTable, { tenantId: admin.tenantId })).toHaveLength(0);
    expect(provider.keys().filter((key) => key.startsWith(`${admin.tenantId}/`))).toEqual([]);
  });

  test("a write that fails after storeRenderedPdf leaves no rows and no bytes", async () => {
    const admin = tenantAdmin(9603);
    const pending = stack.http.writeErr(GENERATE_THEN_FAIL, { number: "X-1" }, admin);
    await waitFor(() => stubReceived === 1);
    releaseHeldRequests();

    const error = await pending;

    expect(error.details).toEqual({ reason: "forced_rollback" });
    expect(
      await selectMany(stack.db, renderedPdfsTable, { tenantId: admin.tenantId }),
    ).toHaveLength(0);
    expect(await selectMany(stack.db, fileRefsTable, { tenantId: admin.tenantId })).toHaveLength(0);
    expect(provider.keys().filter((key) => key.startsWith(`${admin.tenantId}/`))).toEqual([]);
  });
});
