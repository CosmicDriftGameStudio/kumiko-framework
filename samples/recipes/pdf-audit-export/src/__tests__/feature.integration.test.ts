// PDF Audit Export Sample — Integration Test
//
// Proves the whole path through real HTTP calls: inspections are written,
// the export handler renders and stores a PDF, GET /api/files/:id serves it
// and its text contains exactly the inspections of the requested period.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, MAX_LIST_LIMIT } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { extractText, getDocumentProxy } from "unpdf";
import * as z from "zod";
import { inspectionEntity, pdfAuditExportFeature } from "../feature";

const EXPORT_AUDIT = "pdf-audit-export:write:export-audit";

// Another command calling export-audit runs it nested: no beforeTransaction phase of its own.
const nestedExportFeature = defineFeature("nested-export", (r) => {
  r.requires({ features: ["pdf-audit-export"] });
  r.writeHandler({
    name: "run",
    schema: z.object({ assetName: z.string(), from: z.string(), to: z.string() }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => ctx.dispatch.write(EXPORT_AUDIT, event.payload),
  });
});

let stack: TestStack;

const userA = createTestUser({ id: 1, tenantId: testTenantId(1), roles: ["Admin"] });
const userB = createTestUser({ id: 2, tenantId: testTenantId(2), roles: ["Admin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createFilesFeature(), pdfAuditExportFeature, nestedExportFeature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, inspectionEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function addInspection(
  inspectedOn: string,
  result: "ok" | "defect",
  inspector: string,
  assetName = "Kessel 3",
): Promise<void> {
  await stack.http.writeOk(
    "pdf-audit-export:write:inspection:create",
    { assetName, inspectedOn, result, inspector },
    userA,
  );
}

async function download(user: typeof userA, fileRefId: string): Promise<Response> {
  const token = await stack.jwt.sign(user);
  return stack.app.request(`/api/files/${fileRefId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("export-audit", () => {
  test("stores a PDF FileRef containing only the inspections of the period and asset", async () => {
    await addInspection("2026-01-10", "ok", "Zeile-vor-Zeitraum");
    await addInspection("2026-02-05", "defect", "Zeile-im-Zeitraum-Eins");
    await addInspection("2026-03-20", "ok", "Zeile-im-Zeitraum-Zwei");
    await addInspection("2026-05-02", "ok", "Zeile-nach-Zeitraum");
    await addInspection("2026-02-06", "ok", "Zeile-anderer-Asset", "Pumpe 7");

    const { fileRefId } = await stack.http.writeOk<{ fileRefId: string }>(
      "pdf-audit-export:write:export-audit",
      { assetName: "Kessel 3", from: "2026-02-01", to: "2026-03-31" },
      userA,
    );

    const res = await download(userA, fileRefId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const proxy = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const { text } = await extractText(proxy, { mergePages: true });

    expect(text).toContain("Prüfprotokoll Kessel 3");
    expect(text).toContain("05.02.2026");
    expect(text).toContain("Mangel");
    expect(text).toContain("Zeile-im-Zeitraum-Eins");
    expect(text).toContain("20.03.2026");
    expect(text).toContain("Zeile-im-Zeitraum-Zwei");
    expect(text).not.toContain("Zeile-vor-Zeitraum");
    expect(text).not.toContain("Zeile-nach-Zeitraum");
    expect(text).not.toContain("Zeile-anderer-Asset");
    expect(text).toContain("Seite 1 von 1");
  });

  test("a user of another tenant gets 404 for the exported file", async () => {
    await addInspection("2026-02-05", "ok", "Zeile-Tenant-A");
    const { fileRefId } = await stack.http.writeOk<{ fileRefId: string }>(
      "pdf-audit-export:write:export-audit",
      { assetName: "Kessel 3", from: "2026-02-01", to: "2026-03-31" },
      userA,
    );

    expect((await download(userB, fileRefId)).status).toBe(404);
  });

  test("a period without inspections still yields a PDF with the empty hint", async () => {
    const { fileRefId } = await stack.http.writeOk<{ fileRefId: string }>(
      "pdf-audit-export:write:export-audit",
      { assetName: "Unbekannte Anlage", from: "2026-02-01", to: "2026-03-31" },
      userA,
    );

    const res = await download(userA, fileRefId);
    const proxy = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const { text } = await extractText(proxy, { mergePages: true });
    expect(text).toContain("Keine Prüfungen im Zeitraum");
  });

  test("a period with more inspections than the export holds is rejected instead of cut off", async () => {
    const assetName = "Großanlage";
    for (let day = 0; day < MAX_LIST_LIMIT; day += 1) {
      const inspectedOn = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
      await addInspection(inspectedOn, "ok", `Prüfer-${day}`, assetName);
    }

    const err = await stack.http.writeErr(
      "pdf-audit-export:write:export-audit",
      { assetName, from: "2025-01-01", to: "2025-12-31" },
      userA,
    );
    expect(err.httpStatus).toBe(422);
  });

  test("called from another handler it renders and stores inside the caller's transaction", async () => {
    await addInspection("2026-02-05", "defect", "Zeile-verschachtelt", "Kessel 9");

    const { fileRefId } = await stack.http.writeOk<{ fileRefId: string }>(
      "nested-export:write:run",
      { assetName: "Kessel 9", from: "2026-02-01", to: "2026-03-31" },
      userA,
    );

    const res = await download(userA, fileRefId);
    expect(res.status).toBe(200);
    const proxy = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const { text } = await extractText(proxy, { mergePages: true });
    expect(text).toContain("Zeile-verschachtelt");
  });
});
