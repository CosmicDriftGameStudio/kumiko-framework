// document-ingest-foundation — fileRef.created MSP integration test.
//
// Proves the end-to-end trigger flow: upload → fileRef.created →
// documentIngest.requested, gated on mime/size (files-post-processing
// pattern, kumiko-framework#1497).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { documentIngestFoundationFeature } from "../feature";

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

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [createConfigFeature(), documentIngestFoundationFeature],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  stack.events.reset();
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_event_consumers, file_refs RESTART IDENTITY CASCADE`,
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

describe("fileRef.created → documentIngest.requested", () => {
  test("PDF upload requests ingest with the fileRef pointer, no binary", async () => {
    const { id, storageKey } = await uploadFile("invoice.pdf", pdfBytes, "application/pdf");

    await stack.eventDispatcher?.runOnce();

    const rows = await loadIngestRequestedEvents();
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload;
    expect(payload?.["fileRefId"]).toBe(id);
    expect(payload?.["storageKey"]).toBe(storageKey);
    expect(payload?.["mimeType"]).toBe("application/pdf");
    expect(payload?.["data"]).toBeUndefined();
    expect(payload?.["binary"]).toBeUndefined();
  });

  test("image/png upload also requests ingest (Phase-1 mime allowlist)", async () => {
    await uploadFile("scan.png", pngBytes, "image/png");

    await stack.eventDispatcher?.runOnce();

    expect(await loadIngestRequestedEvents()).toHaveLength(1);
  });

  test("unsupported mime type is skipped — no ingest requested", async () => {
    await uploadFile("notes.txt", textBytes, "text/plain");

    await stack.eventDispatcher?.runOnce();

    expect(await loadIngestRequestedEvents()).toHaveLength(0);
  });

  test("oversized file is skipped before the mime check — no ingest requested", async () => {
    // Real uploads can't exceed file-routes.ts' 10mb unconstrained-upload
    // default, well below this feature's 25mb domain cap — so an oversized
    // fileRef.created is inserted directly (bypassing the upload route) to
    // prove the MSP's own size-check fires independently of it.
    await asRawClient(stack.db).unsafe(
      `
      INSERT INTO kumiko_events
      (tenant_id, aggregate_type, aggregate_id, version, type, payload, metadata, created_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
      `,
      [
        admin.tenantId,
        "fileRef",
        "00000000-0000-4000-8000-0000000000ff",
        1,
        "fileRef.created",
        JSON.stringify({
          storageKey: "huge.pdf",
          fileName: "huge.pdf",
          mimeType: "application/pdf",
          size: 26 * 1024 * 1024,
        }),
        "{}",
        admin.id,
      ],
    );

    await stack.eventDispatcher?.runOnce();

    expect(await loadIngestRequestedEvents()).toHaveLength(0);
  });
});
