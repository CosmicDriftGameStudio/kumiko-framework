// A provider job that died after creating the extract leaves a stream with only its created event.
// The catch-up helper appends the missing terminal event once, in the foundation's stream.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  defineMspApply,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { getStreamVersion } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
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
import { appendMissingDocumentExtractEvent } from "../append-missing-extract-event.ts";
import {
  documentExtractFailedPayloadSchema,
  documentExtractReadyPayloadSchema,
} from "../events.ts";
import { createDocumentIngestFoundationFeature } from "../feature.ts";
import { writeDocumentExtractForLiveFileRef } from "../write-document-extract.ts";

const READY_EVENT_QN = "test-extract-events:event:document-extract-ready";
const FAILED_EVENT_QN = "test-extract-events:event:document-extract-failed";
const META_ERROR_PREFIX = "einvoice: ";

const observed: Array<{ readonly type: string; readonly payload: Record<string, unknown> }> = [];

const testProviderFeature = defineFeature("test-extract-events", (r) => {
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

let stack: TestStack;

beforeAll(async () => {
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

// The aborted job run: the extract exists, no terminal event follows.
async function createExtractWithoutTerminalEvent(): Promise<{
  readonly documentExtractId: string;
  readonly fileRefId: string;
}> {
  const { id: fileRefId, storageKey } = await uploadFile();
  const written = await writeDocumentExtractForLiveFileRef({
    tenantDb: tenantDb(),
    actor: createSystemUser(admin.tenantId),
    fileRefId,
    storageKey,
    pages: [{ pageNumber: 1, text: "invoice text" }],
    meta: { provider: "test", ms: 1, needsOcr: false, pagesParsed: 1, totalPages: 1 },
  });
  if (written.kind !== "written") throw new Error(`extract setup skipped: ${written.reason}`);
  return { documentExtractId: written.documentExtractId, fileRefId };
}

function appendMissing(
  existing: { readonly id: string; readonly meta: { readonly error?: unknown } | null },
  fileRefId: string,
) {
  return appendMissingDocumentExtractEvent(
    {
      tenantDb: tenantDb(),
      registry: stack.registry,
      actor: createSystemUser(admin.tenantId),
      tenantId: admin.tenantId,
    },
    existing,
    fileRefId,
    {
      readyEventQn: READY_EVENT_QN,
      failedEventQn: FAILED_EVENT_QN,
      mapError: (error) =>
        error.startsWith(META_ERROR_PREFIX) ? error.slice(META_ERROR_PREFIX.length) : error,
    },
  );
}

const streamVersion = (documentExtractId: string) =>
  getStreamVersion(stack.db, documentExtractId, admin.tenantId);

// The observer runs asynchronously and may still deliver events of earlier tests, so each test
// waits for and reads only the events of its own extract.
async function observedEventsOf(
  documentExtractId: string,
): Promise<Array<{ readonly type: string; readonly payload: Record<string, unknown> }>> {
  const ofExtract = () =>
    observed.filter((event) => event.payload["documentExtractId"] === documentExtractId);
  await waitFor(async () => {
    await stack.eventDispatcher?.runOnce();
    expect(ofExtract().length).toBeGreaterThan(0);
  });
  return ofExtract();
}

describe("appendMissingDocumentExtractEvent", () => {
  test("appends the ready event after the created event when the extract has no error", async () => {
    const { documentExtractId, fileRefId } = await createExtractWithoutTerminalEvent();
    expect(await streamVersion(documentExtractId)).toBe(1);

    const result = await appendMissing({ id: documentExtractId, meta: null }, fileRefId);

    expect(result).toBe("appended-ready");
    expect(await streamVersion(documentExtractId)).toBe(2);
    expect(await observedEventsOf(documentExtractId)).toEqual([
      { type: READY_EVENT_QN, payload: { documentExtractId, fileRefId } },
    ]);
  });

  test("appends the failed event with the mapped error when meta.error is set", async () => {
    const { documentExtractId, fileRefId } = await createExtractWithoutTerminalEvent();

    const result = await appendMissing(
      { id: documentExtractId, meta: { error: `${META_ERROR_PREFIX}kaputt` } },
      fileRefId,
    );

    expect(result).toBe("appended-failed");
    expect(await observedEventsOf(documentExtractId)).toEqual([
      { type: FAILED_EVENT_QN, payload: { documentExtractId, fileRefId, error: "kaputt" } },
    ]);
  });

  test("does nothing on a second call because the stream already has its terminal event", async () => {
    const { documentExtractId, fileRefId } = await createExtractWithoutTerminalEvent();
    await appendMissing({ id: documentExtractId, meta: null }, fileRefId);

    const second = await appendMissing({ id: documentExtractId, meta: null }, fileRefId);

    expect(second).toBe("already-terminal");
    expect(await streamVersion(documentExtractId)).toBe(2);
  });

  test("refuses to append for an unknown extract id and leaves no stream behind", async () => {
    const unknownId = crypto.randomUUID();

    await expect(appendMissing({ id: unknownId, meta: null }, crypto.randomUUID())).rejects.toThrow(
      InternalError,
    );

    expect(await streamVersion(unknownId)).toBe(0);
  });

  test("falls back to a non-empty error when the mapped meta.error is empty", async () => {
    const { documentExtractId, fileRefId } = await createExtractWithoutTerminalEvent();

    const result = await appendMissing(
      { id: documentExtractId, meta: { error: META_ERROR_PREFIX } },
      fileRefId,
    );

    expect(result).toBe("appended-failed");
    expect(await observedEventsOf(documentExtractId)).toEqual([
      {
        type: FAILED_EVENT_QN,
        payload: { documentExtractId, fileRefId, error: META_ERROR_PREFIX },
      },
    ]);
  });
});
