// A stored draft is printed through the real resolver and the real HTTP write pipeline; only the
// print service is a stub that records the HTML it was asked to print. The document-draft feature
// prints through this package directly.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import {
  createDocumentDraftFeature,
  DocumentDraftHandlers,
  DocumentDraftQueries,
} from "@cosmicdrift/kumiko-bundled-features/document-draft";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
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
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { renderedPdfEntity, renderedPdfsTable } from "../entity";
import { createRendererPuppeteerClientFeature } from "../feature";

const SERVICE_TOKEN = "draft-test-service-token";
const STUB_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<< /Type /Pages /Kids [] /Count 1 >>endobj\n%%EOF",
);
const SLUG = "lease-contract";
const SUBJECT_TYPE = "lease";
const CLAUSE = "Haustiere sind erlaubt.";
const TENANT_NAME = "Anna Beispiel";
const LAYOUT_HEAD_MARKER = "Kopfzeile des Layouts";

const printedRequests: string[] = [];
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
    const body = await request.json();
    printedRequests.push(JSON.stringify(body));
    return new Response(STUB_PDF, { headers: { "Content-Type": "application/pdf" } });
  },
});
const STUB_URL = `http://127.0.0.1:${stubService.port}`;

const ENV_KEYS = ["PUPPETEER_SERVICE_URL", "PUPPETEER_AUTH_TOKEN"] as const;
const savedEnv = new Map<string, string | undefined>();

const admin = createTestUser({ id: 9711, roles: ["TenantAdmin"], tenantId: testTenantId(9711) });
const leaseEntity = createEntity({
  name: SUBJECT_TYPE,
  table: "render_draft_test_leases",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 100,
      personal: false,
      reason: "technical_reference",
    }),
  },
});
const leaseHostFeature = defineFeature("render-draft-test-lease-host", (r) => {
  r.entity(leaseEntity);
});
const leaseExecutor = createEventStoreExecutor(
  buildEntityTable(leaseEntity),
  leaseEntity,
  { entityName: SUBJECT_TYPE },
);
const provider = createInMemoryFileProvider();
let stack: TestStack;

beforeAll(async () => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      createFilesFeature(),
      leaseHostFeature,
      createConfigFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererPuppeteerClientFeature(),
      createDocumentDraftFeature({
        subjectTypes: [SUBJECT_TYPE],
      }),
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
      { linkedResources: {}, locale: "de", contentFormat: "html", ...payload },
      TestUsers.systemAdmin,
    );
  await system({
    slug: "draft-layout",
    kind: "pdf-layout",
    content: `<div data-header><p>${LAYOUT_HEAD_MARKER}</p></div><div data-content></div>`,
    meta: {},
    variableSchema: {},
  });
  await system({
    slug: SLUG,
    kind: "document-pdf",
    content: '<p>Mietvertrag fuer <span data-variable="partyName"></span></p><p>Zweiter Absatz</p>',
    variableSchema: { partyName: { type: "text" } },
    meta: { layoutSlug: "draft-layout" },
  });
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
  await stubService.stop(true);
});

beforeEach(() => {
  printedRequests.length = 0;
  provider.clear();
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env["PUPPETEER_SERVICE_URL"] = STUB_URL;
  process.env["PUPPETEER_AUTH_TOKEN"] = SERVICE_TOKEN;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

async function seedLease(): Promise<string> {
  const created = await leaseExecutor.create(
    { name: "Lease" },
    admin,
    createTenantDb({
      db: stack.db,
      tenantId: admin.tenantId,
      mode: "system",
      reason: "test seeds the subject row",
    }),
  );
  if (!created.isSuccess) throw new Error(`lease create failed: ${created.error.message}`);
  return String(created.data.id);
}

describe("finalize with renderPdfBeforeTransaction", () => {
  test("prints the edited draft body with the layout of the template and stores the PDF", async () => {
    const created = await stack.http.writeOk<{ id: string; version: number }>(
      DocumentDraftHandlers.create,
      {
        subjectType: SUBJECT_TYPE,
        subjectId: await seedLease(),
        templateSlug: SLUG,
        variables: { partyName: TENANT_NAME },
      },
      admin,
    );
    const patched = await stack.http.writeOk<{ version: number }>(
      DocumentDraftHandlers.patch,
      {
        id: created.id,
        base: created.version,
        ops: [{ op: "insertBlock", after: "b0", block: { type: "paragraph", text: CLAUSE } }],
      },
      admin,
    );

    const finalized = await stack.http.writeOk<{ fileRefId: string; fileName: string }>(
      DocumentDraftHandlers.finalize,
      { id: created.id, base: patched.version },
      admin,
    );

    expect(printedRequests).toHaveLength(1);
    expect(printedRequests[0]).toContain(CLAUSE);
    expect(printedRequests[0]).toContain(TENANT_NAME);
    expect(printedRequests[0]).toContain(LAYOUT_HEAD_MARKER);

    const stored = await selectMany(stack.db, renderedPdfsTable, { tenantId: admin.tenantId });
    expect(stored.map((row) => String(Reflect.get(row, "fileRefId")))).toEqual([
      finalized.fileRefId,
    ]);

    const draft = await stack.http.queryOk<{ status: string; fileRefId: string }>(
      DocumentDraftQueries.blocks,
      { id: created.id },
      admin,
    );
    expect(draft).toMatchObject({ status: "finalized", fileRefId: finalized.fileRefId });
  });
});
