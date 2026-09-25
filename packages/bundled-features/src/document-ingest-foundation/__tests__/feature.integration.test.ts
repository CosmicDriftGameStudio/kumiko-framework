// document-ingest-foundation — fileRef.created MSP integration test.
//
// Proves the end-to-end trigger flow: upload → fileRef.created →
// documentIngest.requested, gated on the mounted provider's mimeTypes/size
// cap. Mounts small test provider features instead of relying on any
// hardcoded allowlist/cap — there is none anymore.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { documentExtractEntity, documentExtractsTable } from "../entity";
import { documentIngestFoundationFeature } from "../feature";
import { writeIngestPages } from "../pages";
import { documentIngestProviderTrigger, EXT_DOCUMENT_INGEST_PROVIDER } from "../providers";

// Small test providers — mirror kumiko-enterprise's LiteParse shape without
// pulling it in: A claims pdf/png, B claims docx, each with a deliberately
// tiny cap so the "oversized" case doesn't need a multi-MB fixture.
const PROVIDER_A_NAME = "test-provider-a";
const PROVIDER_A_MAX_BYTES = 200;
const PROVIDER_B_NAME = "test-provider-b";
const PROVIDER_B_MAX_BYTES = 500;
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const providerAProcessed: Array<{ readonly fileRefId: string }> = [];
const providerBProcessed: Array<{ readonly fileRefId: string }> = [];

const testProviderAFeature = defineFeature("test-document-ingest-provider-a", (r) => {
  r.requires("document-ingest-foundation");
  r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, PROVIDER_A_NAME, {
    mimeTypes: ["application/pdf", "image/png"],
    maxFileBytes: PROVIDER_A_MAX_BYTES,
  });
  r.job(
    "test-provider-a-worker",
    { trigger: documentIngestProviderTrigger(PROVIDER_A_NAME), runIn: "worker" },
    async (payload) => {
      providerAProcessed.push({ fileRefId: payload["fileRefId"] as string });
    },
  );
});

const testProviderBFeature = defineFeature("test-document-ingest-provider-b", (r) => {
  r.requires("document-ingest-foundation");
  r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, PROVIDER_B_NAME, {
    mimeTypes: [DOCX_MIME_TYPE],
    maxFileBytes: PROVIDER_B_MAX_BYTES,
  });
  r.job(
    "test-provider-b-worker",
    { trigger: documentIngestProviderTrigger(PROVIDER_B_NAME), runIn: "worker" },
    async (payload) => {
      providerBProcessed.push({ fileRefId: payload["fileRefId"] as string });
    },
  );
});

let stack: TestStack;
let provider: InMemoryFileProvider;

const admin = TestUsers.admin;

const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");
const pngBytes = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(64).fill(0),
]);
const textBytes = new TextEncoder().encode("plain text, not a supported mime type");
const oversizedPdfBytes = new Uint8Array(PROVIDER_A_MAX_BYTES + 100);
// Real ZIP local-file-header signature — validateFileContent content-verifies
// docx uploads against it independent of options.accept.
const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array(32).fill(0)]);

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});
const documentExtractExecutorForSeed = createEventStoreExecutor(
  documentExtractsTable,
  documentExtractEntity,
  { entityName: "document-extract" },
);

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      documentIngestFoundationFeature,
      testProviderAFeature,
      testProviderBFeature,
    ],
    files: { storageProvider: provider },
    // Distinct prefix: avoids sharing a BullMQ queue namespace with any other
    // setupTestStack call on the same test Redis.
    jobs: { consumerLane: "worker", queueNamePrefix: `document-ingest-foundation-${generateId()}` },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  providerAProcessed.length = 0;
  providerBProcessed.length = 0;
  stack.events.reset();
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_event_consumers, file_refs, read_document_extracts RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

async function uploadFile(
  fileName: string,
  content: Uint8Array,
  mimeType: string,
): Promise<{ id: string; storageKey: string }> {
  const token = await stack.jwt.sign(admin);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(content)], fileName, { type: mimeType }));
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; storageKey: string };
  return body;
}

async function loadIngestRequestedEvents(): Promise<{ payload: Record<string, unknown> }[]> {
  const rows = await asRawClient(stack.db).unsafe(
    `SELECT payload FROM kumiko_events WHERE type = $1`,
    ["document-ingest-foundation:event:document-ingest-requested"],
  );
  return rows as { payload: Record<string, unknown> }[];
}

async function loadIngestSkippedEvents(): Promise<{ payload: Record<string, unknown> }[]> {
  const rows = await asRawClient(stack.db).unsafe(
    `SELECT payload FROM kumiko_events WHERE type = $1`,
    ["document-ingest-foundation:event:document-ingest-skipped"],
  );
  return rows as { payload: Record<string, unknown> }[];
}

async function seedDocumentExtract(tenantId: TenantId, fileRefId: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const tdb = createTenantDb(stack.db, tenantId);
  const result = await documentExtractExecutorForSeed.create(
    {
      fileRefId,
      storageKey: `s3://bucket/${fileRefId}`,
      pages: writeIngestPages([{ pageNumber: 1, text: "invoice text" }]),
      meta: { provider: PROVIDER_A_NAME, ms: 1, needsOcr: false, pagesParsed: 1, totalPages: 1 },
    },
    user,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.message}`);
  return String(result.data.id);
}

describe("fileRef.created → documentIngest.requested", () => {
  test("PDF upload requests ingest with the fileRef pointer, no binary, tagged with the winning provider", async () => {
    const { id, storageKey } = await uploadFile("invoice.pdf", pdfBytes, "application/pdf");

    await stack.eventDispatcher?.runOnce();

    const rows = await loadIngestRequestedEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({
      fileRefId: id,
      storageKey,
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      size: pdfBytes.length,
      provider: PROVIDER_A_NAME,
    });
  });

  test("image/png upload also requests ingest — same provider claims both mimeTypes", async () => {
    await uploadFile("scan.png", pngBytes, "image/png");

    await stack.eventDispatcher?.runOnce();

    expect(await loadIngestRequestedEvents()).toHaveLength(1);
  });

  test("provider's job actually receives the request via the where-filtered trigger", async () => {
    const { id } = await uploadFile("invoice.pdf", pdfBytes, "application/pdf");

    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      expect(providerAProcessed).toHaveLength(1);
    });

    expect(providerAProcessed).toEqual([{ fileRefId: id }]);
  });

  test("two mounted providers stay isolated — a pdf only reaches provider A's job, a docx only reaches provider B's job", async () => {
    const { id: pdfId } = await uploadFile("invoice.pdf", pdfBytes, "application/pdf");
    const { id: docxId } = await uploadFile("report.docx", docxBytes, DOCX_MIME_TYPE);

    await stack.eventDispatcher?.runOnce();

    const requested = await loadIngestRequestedEvents();
    expect(requested).toHaveLength(2);
    expect(requested).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ fileRefId: pdfId, provider: PROVIDER_A_NAME }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({ fileRefId: docxId, provider: PROVIDER_B_NAME }),
        }),
      ]),
    );

    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      expect(providerAProcessed).toHaveLength(1);
      expect(providerBProcessed).toHaveLength(1);
    });

    expect(providerAProcessed).toEqual([{ fileRefId: pdfId }]);
    expect(providerBProcessed).toEqual([{ fileRefId: docxId }]);
  });

  test("unsupported mime type is skipped — no provider claims it, no ingest requested", async () => {
    const { id, storageKey } = await uploadFile("notes.txt", textBytes, "text/plain");

    await stack.eventDispatcher?.runOnce();

    expect(await loadIngestRequestedEvents()).toHaveLength(0);
    const skipped = await loadIngestSkippedEvents();
    expect(skipped).toHaveLength(1);
    // mimeType not pinned exactly: the upload route/File API append a
    // charset suffix ("text/plain;charset=utf-8") that isn't this MSP's
    // concern — the no-provider-claims-it miss is.
    expect(skipped[0]?.payload).toMatchObject({
      fileRefId: id,
      storageKey,
      fileName: "notes.txt",
      reason: "unsupported-mime-type",
    });
    expect(String(skipped[0]?.payload["mimeType"])).toStartWith("text/plain");
  });

  test("file over the winning provider's maxFileBytes is skipped as file-too-large", async () => {
    const { id, storageKey } = await uploadFile("huge.pdf", oversizedPdfBytes, "application/pdf");

    await stack.eventDispatcher?.runOnce();

    expect(await loadIngestRequestedEvents()).toHaveLength(0);
    const skipped = await loadIngestSkippedEvents();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.payload).toEqual({
      fileRefId: id,
      storageKey,
      fileName: "huge.pdf",
      mimeType: "application/pdf",
      size: oversizedPdfBytes.length,
      reason: "file-too-large",
    });
  });
});

describe("fileRef delete/forget cleanup", () => {
  test("fileRef.deleted forgets the associated documentExtract row, leaving other fileRefs' extracts untouched", async () => {
    const { id: fileRefId } = await uploadFile("invoice.pdf", pdfBytes, "application/pdf");
    const extractId = await seedDocumentExtract(admin.tenantId, fileRefId);
    const { id: otherFileRefId } = await uploadFile("other.pdf", pdfBytes, "application/pdf");
    const otherExtractId = await seedDocumentExtract(admin.tenantId, otherFileRefId);

    const token = await stack.jwt.sign(admin);
    const res = await stack.app.request(`/api/files/${fileRefId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    await stack.eventDispatcher?.runOnce();

    expect(await selectMany(stack.db, documentExtractsTable, { id: extractId })).toHaveLength(0);
    expect(await selectMany(stack.db, documentExtractsTable, { id: otherExtractId })).toHaveLength(
      1,
    );
  });

  test("fileRef.forgotten forgets the associated documentExtract row, leaving other fileRefs' extracts untouched", async () => {
    const { id: fileRefId } = await uploadFile("invoice.pdf", pdfBytes, "application/pdf");
    const extractId = await seedDocumentExtract(admin.tenantId, fileRefId);
    const { id: otherFileRefId } = await uploadFile("other.pdf", pdfBytes, "application/pdf");
    const otherExtractId = await seedDocumentExtract(admin.tenantId, otherFileRefId);

    const user = createSystemUser(admin.tenantId);
    const tdb = createTenantDb(stack.db, admin.tenantId);
    const result = await fileRefExecutor.forget({ id: fileRefId }, user, tdb);
    if (!result.isSuccess) throw new Error(`fileRef forget failed: ${result.error.message}`);

    await stack.eventDispatcher?.runOnce();

    expect(await selectMany(stack.db, documentExtractsTable, { id: extractId })).toHaveLength(0);
    expect(await selectMany(stack.db, documentExtractsTable, { id: otherExtractId })).toHaveLength(
      1,
    );
  });

  test("fileRef.deleted with no documentExtract row leaves the cleanup consumer healthy", async () => {
    const { id: fileRefId } = await uploadFile("invoice.pdf", pdfBytes, "application/pdf");

    const token = await stack.jwt.sign(admin);
    const res = await stack.app.request(`/api/files/${fileRefId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    // fileRef.deleted is the latest event at this point (fileRef.created
    // already happened during upload) — its id is the bar the cleanup
    // consumer's cursor must clear to prove it actually processed it,
    // not just an earlier event, without throwing.
    const [deletedEventRow] = (await asRawClient(stack.db).unsafe(
      `SELECT id FROM kumiko_events ORDER BY id DESC LIMIT 1`,
    )) as { id: string }[];
    if (!deletedEventRow) throw new Error("fileRef.deleted event not found");

    await stack.eventDispatcher?.runOnce();

    const rows = await asRawClient(stack.db).unsafe(
      `SELECT status, last_error, last_processed_event_id FROM kumiko_event_consumers WHERE name = $1`,
      ["document-ingest-foundation:projection:forget-extract-with-file-ref"],
    );
    const consumer = (
      rows as { status: string; last_error: string | null; last_processed_event_id: string }[]
    )[0];
    expect(consumer?.last_error).toBeNull();
    // bigint columns round-trip as strings through the pg driver.
    expect(Number(consumer?.last_processed_event_id)).toBeGreaterThanOrEqual(
      Number(deletedEventRow.id),
    );
  });
});

describe("fileRef.created — no provider mounted", () => {
  let noProviderStack: TestStack;
  let noProviderFileProvider: InMemoryFileProvider;

  beforeAll(async () => {
    noProviderFileProvider = createInMemoryFileProvider();
    noProviderStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        documentIngestFoundationFeature,
      ],
      files: { storageProvider: noProviderFileProvider },
      jobs: {
        consumerLane: "worker",
        queueNamePrefix: `document-ingest-foundation-no-provider-${generateId()}`,
      },
    });
    await unsafeCreateEntityTable(noProviderStack.db, tenantEntity);
  });

  afterAll(async () => {
    await noProviderStack.cleanup();
  });

  test("pdf upload is skipped as unsupported-mime-type — mounting the feature with zero providers is valid", async () => {
    const token = await noProviderStack.jwt.sign(admin);
    const formData = new FormData();
    formData.append(
      "file",
      new File([Buffer.from(pdfBytes)], "invoice.pdf", { type: "application/pdf" }),
    );
    const uploadRes = await noProviderStack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    expect(uploadRes.status).toBe(201);

    await noProviderStack.eventDispatcher?.runOnce();

    const requested = await asRawClient(noProviderStack.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = $1`,
      ["document-ingest-foundation:event:document-ingest-requested"],
    );
    expect(requested).toHaveLength(0);

    const skipped = await asRawClient(noProviderStack.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = $1`,
      ["document-ingest-foundation:event:document-ingest-skipped"],
    );
    expect(skipped).toHaveLength(1);
    expect((skipped as { payload: Record<string, unknown> }[])[0]?.payload).toMatchObject({
      reason: "unsupported-mime-type",
    });
  });
});
