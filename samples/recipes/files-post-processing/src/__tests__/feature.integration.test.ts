// Files Post-Processing Sample — Integration Test
//
// Proves the end-to-end flow a real app would rely on:
//
//   1. POST /api/files writes the binary + FileRef + event atomically.
//   2. The event-dispatcher delivers `files:event:uploaded` to the MSP.
//   3. The MSP resolves the binary via ctx.files.ref(key).read() — no
//      binary ever rode through the event payload.
//   4. The derivate is written under a keyed variant (.thumb) the
//      original handle can reconstruct without any lookup table.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createInMemoryFileProvider,
  FILE_UPLOADED_EVENT_TYPE,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { sql } from "@cosmicdrift/kumiko-framework/db";
import { derivateLog, filesPostProcessingFeature } from "../feature";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";

let stack: TestStack;
let provider: InMemoryFileProvider;

const admin = TestUsers.admin;

// PNG magic bytes + padding so validateFile's MIME/extension cross-check
// accepts it as a real image/png.
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

const pdfBytes = new TextEncoder().encode("%PDF-1.4 minimal");

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [filesPostProcessingFeature],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  derivateLog.length = 0;
  stack.events.reset();
  // Truncate events + consumer cursors + file_refs so each case starts from
  // a clean log and the dispatcher replays only the current upload.
  await asRawClient(stack.db).unsafe(`TRUNCATE kumiko_events, kumiko_event_consumers, file_refs RESTART IDENTITY CASCADE`);
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

describe("image upload → MSP writes thumb under a derived key", () => {
  test("image/png gets a .thumb variant in the same provider", async () => {
    const { storageKey } = await uploadFile("logo.png", pngBytes, "image/png");

    // Before the dispatcher runs: only the original exists. This proves
    // the MSP hasn't fired yet — the event sits in the events table, the
    // consumer cursor hasn't advanced.
    expect(provider.keys()).toEqual([storageKey]);

    // Drain the dispatcher deterministically.
    await stack.eventDispatcher?.runOnce();

    expect(derivateLog).toHaveLength(1);
    expect(derivateLog[0]?.originalKey).toBe(storageKey);

    // derive("thumb") inserts the suffix before the last extension, so
    // `foo.png` → `foo.thumb.png`. The sample's identity-transform writes
    // the same bytes, so a roundtrip confirms the MSP read + write path.
    const thumbKey = derivateLog[0]?.derivateKey as string;
    expect(thumbKey).toMatch(/\.thumb\.png$/);
    expect(provider.keys().sort()).toEqual([storageKey, thumbKey].sort());

    const thumbBytes = await provider.read(thumbKey);
    expect(Array.from(thumbBytes)).toEqual(Array.from(pngBytes));
  });

  test("non-image upload is skipped by the MSP", async () => {
    // PDFs aren't images — the MSP's mimeType-check bails before the
    // read/write. No derivate, no log entry.
    // Note: we upload without specifying an entity/field, so the upload
    // route doesn't look up field.accept constraints — it uses the
    // global default (10mb, any type).
    const { storageKey } = await uploadFile("doc.pdf", pdfBytes, "application/pdf");

    await stack.eventDispatcher?.runOnce();

    expect(derivateLog).toHaveLength(0);
    expect(provider.keys()).toEqual([storageKey]);
  });
});

describe("event emission contract", () => {
  test("event payload carries storageKey, not the binary", async () => {
    await uploadFile("logo.png", pngBytes, "image/png");

    // Inspect the raw event row. The MSP path already proved the payload's
    // pointer-shape by reading through it, but this test guards the
    // contract directly: no one accidentally adds a binary field later
    // and explodes the events table.
    const rows = await asRawClient(stack.db).unsafe(`SELECT type, payload FROM kumiko_events WHERE type = $1`, [FILE_UPLOADED_EVENT_TYPE]);
    expect(rows.length).toBe(1);
    const payload = rows[0]?.["payload"];
    expect(typeof payload["storageKey"]).toBe("string");
    expect(payload["mimeType"]).toBe("image/png");
    expect(payload["data"]).toBeUndefined();
    expect(payload["binary"]).toBeUndefined();
    expect(payload["bytes"]).toBeUndefined();
  });
});
