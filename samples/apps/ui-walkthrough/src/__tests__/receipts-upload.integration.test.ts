// The receipts upload form: files arrive pending under the form, the handler moves each one onto
// a receipt record. Real HTTP upload route plus the real rental feature.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupAppTestStack } from "@cosmicdrift/kumiko-dev-server/testing";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { rentalFeature } from "../features/rental/feature";

const UPLOAD_SCREEN = "rental:screen:upload-standard-layout";
const RECEIPTS_UPLOAD = "rental:write:receipts-upload";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");

let stack: TestStack;
const owner = createTestUser({ id: 1, roles: ["Admin"] });
const other = createTestUser({ id: 2, roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupAppTestStack([createFilesFeature(), rentalFeature], {
    files: { storageProvider: createInMemoryFileProvider() },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function uploadToForm(as: typeof owner, fileName: string): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("actionForm", UPLOAD_SCREEN);
  fd.append("fieldName", "belege");
  fd.append("file", new File([Buffer.from(PDF_BYTES)], fileName, { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function fileRefRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await selectMany(stack.db, fileRefsTable, { id });
  if (!row) throw new Error(`fileRef ${id} missing`);
  return row;
}

describe("rental:write:receipts-upload", () => {
  test("a form upload is pending under the screen, then bound to a receipt by the handler", async () => {
    const id = await uploadToForm(owner, "Rechnung-Oktober.pdf");
    expect(await fileRefRow(id)).toMatchObject({
      entityType: UPLOAD_SCREEN,
      fieldName: "belege",
      entityId: null,
    });

    const result = await stack.http.writeOk<{
      count: number;
      belege: readonly { label: string }[];
    }>(RECEIPTS_UPLOAD, { belege: [id] }, owner);

    expect(result).toEqual({ count: 1, belege: [{ label: "Rechnung-Oktober.pdf" }] });
    const bound = await fileRefRow(id);
    expect(bound).toMatchObject({ entityType: "receipt", fieldName: "datei" });
    expect(bound["entityId"]).toEqual(expect.any(String));
  });

  test("another user's upload is refused and nothing of the batch is written", async () => {
    const mine = await uploadToForm(owner, "mein-beleg.pdf");
    const foreign = await uploadToForm(other, "fremd.pdf");

    const error = await stack.http.writeErr(RECEIPTS_UPLOAD, { belege: [mine, foreign] }, owner);

    expect(error.code).toBe("unprocessable");
    expect(await fileRefRow(mine)).toMatchObject({ entityType: UPLOAD_SCREEN, entityId: null });
    expect(await fileRefRow(foreign)).toMatchObject({ entityType: UPLOAD_SCREEN, entityId: null });
  });

  test("an already bound upload cannot be submitted again", async () => {
    const id = await uploadToForm(owner, "einmal.pdf");
    await stack.http.writeOk(RECEIPTS_UPLOAD, { belege: [id] }, owner);

    const error = await stack.http.writeErr(RECEIPTS_UPLOAD, { belege: [id] }, owner);

    expect(error.code).toBe("unprocessable");
  });

  test("an id that was never uploaded is refused", async () => {
    const error = await stack.http.writeErr(
      RECEIPTS_UPLOAD,
      { belege: [crypto.randomUUID()] },
      owner,
    );
    expect(error.code).toBe("unprocessable");
  });
});
