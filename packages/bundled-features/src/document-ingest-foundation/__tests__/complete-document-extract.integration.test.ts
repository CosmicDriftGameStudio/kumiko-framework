// completeDocumentExtract writes the extract and its terminal event in one call, catches up the
// event of an aborted delivery and skips files that are gone; the readers return what it wrote.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  defineMspApply,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { completeDocumentExtract } from "../complete-document-extract.ts";
import {
  listDocumentExtractSummaries,
  loadDocumentExtract,
  loadDocumentIngestProgress,
} from "../document-extract-reader.ts";
import { documentExtractsTable } from "../entity.ts";
import {
  documentExtractFailedPayloadSchema,
  documentExtractReadyPayloadSchema,
} from "../events.ts";
import { createDocumentIngestFoundationFeature } from "../feature.ts";
import { reportIngestProgress } from "../report-ingest-progress.ts";
import { writeDocumentExtractForLiveFileRef } from "../write-document-extract.ts";

const READY_EVENT_QN = "test-complete-extract:event:document-extract-ready";
const FAILED_EVENT_QN = "test-complete-extract:event:document-extract-failed";
const META_ERROR_PREFIX = "einvoice: ";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000999";

const observed: Array<{ readonly type: string; readonly payload: Record<string, unknown> }> = [];

const testProviderFeature = defineFeature("test-complete-extract", (r) => {
  r.requires({ features: ["document-ingest-foundation"] });
  r.defineEvent("document-extract.ready", documentExtractReadyPayloadSchema, {
    piiFields: "none",
  });
  r.defineEvent("document-extract.failed", documentExtractFailedPayloadSchema, {
    piiFields: "none",
  });
  r.multiStreamProjection({
    name: "observe-terminal-events",
    apply: {
      [READY_EVENT_QN]: defineMspApply(async (event) => {
        observed.push({ type: event.type, payload: event.payload });
      }),
      [FAILED_EVENT_QN]: defineMspApply(async (event) => {
        observed.push({ type: event.type, payload: event.payload });
      }),
    },
  });
});

const admin = TestUsers.admin;
const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");
const okMeta = { provider: "test", ms: 1, needsOcr: false, pagesParsed: 1, totalPages: 1 };
const pages = [{ pageNumber: 1, text: "invoice text" }];

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createDocumentIngestFoundationFeature(),
      testProviderFeature,
    ],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await stack.eventDispatcher?.ensureRegistered();
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  observed.length = 0;
});

async function uploadFile(): Promise<{ id: string; storageKey: string }> {
  const token = await stack.jwt.sign(admin);
  const formData = new FormData();
  formData.append(
    "file",
    new File([Buffer.from(pdfBytes)], "invoice.pdf", { type: "application/pdf" }),
  );
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; storageKey: string };
}

const tenantDb = () => createTenantDb({ db: stack.db, tenantId: admin.tenantId });
const systemUser = () => createSystemUser(admin.tenantId);

const deps = () => ({
  tenantDb: tenantDb(),
  registry: stack.registry,
  actor: systemUser(),
});

const options = {
  readyEventQn: READY_EVENT_QN,
  failedEventQn: FAILED_EVENT_QN,
  mapError: (error: string) =>
    error.startsWith(META_ERROR_PREFIX) ? error.slice(META_ERROR_PREFIX.length) : error,
};

async function observedEventsOf(fileRefId: string) {
  const ofFile = () => observed.filter((event) => event.payload["fileRefId"] === fileRefId);
  await waitFor(async () => {
    await stack.eventDispatcher?.runOnce();
    expect(ofFile().length).toBeGreaterThan(0);
  });
  return ofFile();
}

async function extractsOf(fileRefId: string) {
  return selectMany<{ id: string }>(stack.db, documentExtractsTable, { fileRefId });
}

async function complete(
  file: { id: string; storageKey: string },
  meta: typeof okMeta & Record<string, unknown> = okMeta,
) {
  return completeDocumentExtract(
    deps(),
    { fileRefId: file.id, storageKey: file.storageKey, pages, meta },
    options,
  );
}

describe("completeDocumentExtract", () => {
  test("writes the extract, appends the ready event and loads back", async () => {
    const file = await uploadFile();

    expect(await complete(file)).toBe("appended-ready");

    const events = await observedEventsOf(file.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(READY_EVENT_QN);
    expect(events[0]?.payload["fileRefId"]).toBe(file.id);
    const [extract] = await extractsOf(file.id);
    expect(events[0]?.payload["documentExtractId"]).toBe(extract?.id);

    const loaded = await loadDocumentExtract({ db: tenantDb(), user: systemUser() }, file.id);
    expect(loaded?.pages).toEqual(pages);
    expect(loaded?.hasError).toBe(false);
    expect(loaded?.meta?.["provider"]).toBe("test");
  });

  test("appends the failed event with the mapped error when meta.error is set", async () => {
    const file = await uploadFile();

    const result = await complete(file, { ...okMeta, error: "einvoice: broken" });

    expect(result).toBe("appended-failed");
    const events = await observedEventsOf(file.id);
    expect(events[0]?.type).toBe(FAILED_EVENT_QN);
    expect(events[0]?.payload["error"]).toBe("broken");
    const summary = (await listDocumentExtractSummaries(tenantDb(), [file.id])).get(file.id);
    expect(summary?.hasError).toBe(true);
  });

  test("a redelivery changes nothing and appends no event", async () => {
    const file = await uploadFile();
    await complete(file);
    await observedEventsOf(file.id);

    expect(await complete(file)).toBe("already-terminal");

    await stack.eventDispatcher?.runOnce();
    expect(await extractsOf(file.id)).toHaveLength(1);
    expect(observed.filter((event) => event.payload["fileRefId"] === file.id)).toHaveLength(1);
  });

  test("catches up the event of a delivery that wrote the extract and died", async () => {
    const file = await uploadFile();
    const written = await writeDocumentExtractForLiveFileRef({
      tenantDb: tenantDb(),
      actor: systemUser(),
      fileRefId: file.id,
      storageKey: file.storageKey,
      pages,
      meta: okMeta,
    });
    if (written.kind !== "written") throw new Error("extract setup skipped");

    expect(await complete(file)).toBe("appended-ready");

    const events = await observedEventsOf(file.id);
    expect(events[0]?.payload["documentExtractId"]).toBe(written.documentExtractId);
    expect(await extractsOf(file.id)).toHaveLength(1);
  });

  test("skips a deleted file without extract or event", async () => {
    const file = await uploadFile();
    const token = await stack.jwt.sign(admin);
    const deleted = await stack.app.request(`/api/files/${file.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleted.status).toBe(200);

    expect(await complete(file)).toBe("skipped-file-ref-deleted");

    await stack.eventDispatcher?.runOnce();
    expect(await extractsOf(file.id)).toHaveLength(0);
    expect(observed.filter((event) => event.payload["fileRefId"] === file.id)).toHaveLength(0);
  });
});

describe("document extract readers", () => {
  test("listDocumentExtractSummaries maps known file refs and ignores unknown ones", async () => {
    const a = await uploadFile();
    const b = await uploadFile();
    await complete(a);
    await complete(b, { ...okMeta, error: "einvoice: broken" });

    const summaries = await listDocumentExtractSummaries(tenantDb(), [a.id, b.id, UNKNOWN_ID]);

    expect([...summaries.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(summaries.get(a.id)?.id).toBe((await extractsOf(a.id))[0]?.id ?? "");
    expect(summaries.get(a.id)?.meta?.["provider"]).toBe("test");
    expect(summaries.get(b.id)?.id).toBe((await extractsOf(b.id))[0]?.id ?? "");
    expect(summaries.get(b.id)?.hasError).toBe(true);
    expect((await listDocumentExtractSummaries(tenantDb(), [])).size).toBe(0);
  });

  test("an erased record key makes the text unreadable but keeps the plaintext summary", async () => {
    const file = await uploadFile();
    await complete(file);
    const [extract] = await extractsOf(file.id);
    if (!extract) throw new Error("extract missing");

    await kms.eraseKey({ kind: "record", entity: "document-extract", id: extract.id });

    expect(await loadDocumentExtract({ db: tenantDb(), user: systemUser() }, file.id)).toBeNull();
    expect((await listDocumentExtractSummaries(tenantDb(), [file.id])).has(file.id)).toBe(true);
    expect(
      await loadDocumentExtract({ db: tenantDb(), user: systemUser() }, UNKNOWN_ID),
    ).toBeNull();
  });

  test("loadDocumentIngestProgress returns the reported progress or null", async () => {
    const file = await uploadFile();
    await reportIngestProgress(tenantDb(), { fileRefId: file.id, pagesDone: 2, pagesTotal: 5 });

    expect(await loadDocumentIngestProgress(tenantDb(), file.id)).toEqual({
      pagesDone: 2,
      pagesTotal: 5,
    });
    expect(await loadDocumentIngestProgress(tenantDb(), UNKNOWN_ID)).toBeNull();
  });
});
