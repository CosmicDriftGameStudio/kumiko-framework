import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorQueries } from "../constants.ts";
import {
  pairDevice,
  setupConnectorsStack,
  teardownConnectorsStack,
  tenantAdmin,
  upload,
} from "./connectors-stack.ts";

type Hit = {
  id: string;
  kind: "folder" | "file";
  name: string;
  connectorId: string;
  folderId: string | null;
  path: string;
  totalBytes: number;
};
type SearchAnswer = { rows: Hit[]; truncated: boolean };

const otherTenantAdmin = createTestUser({
  id: 41,
  tenantId: testTenantId(8),
  roles: ["TenantAdmin"],
});
const PDF_HEADER = new TextEncoder().encode("%PDF-1.4\n");
const bytesOf = (size: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(PDF_HEADER);
  return bytes;
};

let stack: TestStack;
let connectorId: string;
let pairedConnector: Promise<{ connectorId: string }>;

// 3 folders and 3 files: six names to scan.
async function seededStack(options: { maxSearchNames?: number }): Promise<TestStack> {
  const own = await setupConnectorsStack(options, undefined, createInMemoryFileProvider());
  const paired = await pairDevice(own);
  pairedConnector = Promise.resolve({ connectorId: paired.connectorId });
  for (const path of [
    "Rechnungen/2026/Rechnung-Meier.pdf",
    "Rechnungen/Angebot.pdf",
    "Lieferscheine/LS-4471.pdf",
  ]) {
    expect((await upload(own, paired.token, { path, bytes: bytesOf(20) })).status).toBe(201);
  }
  return own;
}
const search = (
  payload: { term: string; connectorId?: string; folderId?: string },
  user = tenantAdmin,
) => stack.http.queryOk<SearchAnswer>(ConnectorQueries.inboundSearch, payload, user);

beforeAll(async () => {
  stack = await seededStack({});
  ({ connectorId } = await pairedConnector);
});
afterAll(() => teardownConnectorsStack(stack));

describe("file search", () => {
  test("finds part of a name regardless of case, with the path of a file in a subfolder", async () => {
    const found = await search({ term: "MEIER" });
    expect(found.truncated).toBe(false);
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]).toMatchObject({
      kind: "file",
      name: "Rechnung-Meier.pdf",
      path: "Office server / Rechnungen / 2026",
      totalBytes: 20,
    });
  });

  test("finds folders too, and a hit opens its own folder", async () => {
    const found = await search({ term: "rechnungen" });
    const folder = found.rows.find((row) => row.kind === "folder");
    expect(folder).toMatchObject({
      name: "Rechnungen",
      path: "Office server",
      folderId: folder?.id,
    });
  });

  test("below a folder it finds only what sits in that folder's subtree", async () => {
    const all = await search({ term: "pdf" });
    expect(all.rows.map((row) => row.name).sort()).toEqual([
      "Angebot.pdf",
      "LS-4471.pdf",
      "Rechnung-Meier.pdf",
    ]);
    const folder = (await search({ term: "Lieferscheine", connectorId })).rows[0];
    const below = await search({ term: "pdf", connectorId, folderId: folder?.id });
    expect(below.rows.map((row) => row.name)).toEqual(["LS-4471.pdf"]);
  });

  test("another tenant sees nothing", async () => {
    expect((await search({ term: "pdf" }, otherTenantAdmin)).rows).toEqual([]);
  });

  test("a term shorter than two characters is rejected", async () => {
    const res = await stack.http.query(ConnectorQueries.inboundSearch, { term: "a" }, tenantAdmin);
    expect(res.ok).toBe(false);
  });

  test("stops at the name limit and says so", async () => {
    const small = await seededStack({ maxSearchNames: 4 });
    try {
      const found = await small.http.queryOk<SearchAnswer>(
        ConnectorQueries.inboundSearch,
        { term: "pd" },
        tenantAdmin,
      );
      expect(found.truncated).toBe(true);
    } finally {
      await teardownConnectorsStack(small);
    }
  });
});
