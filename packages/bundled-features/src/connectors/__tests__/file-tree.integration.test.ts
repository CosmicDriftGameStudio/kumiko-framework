import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorHandlers, ConnectorQueries } from "../constants.ts";
import { inboundFolderTable } from "../schema/inbound-folder.ts";
import { inboundItemTable } from "../schema/inbound-item.ts";
import { runConnectorJobs, uploadConnectorFile } from "../testing.ts";
import {
  pairDevice,
  setupConnectorsStack,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

type Row = {
  id: string;
  kind: "device" | "folder" | "file";
  name: string;
  connectorId: string;
  folderId: string | null;
  fileCount: number | null;
  totalBytes: number;
  receivedAt: string | null;
  deleting: boolean;
};
type TreeAnswer = {
  usedBytes: number;
  quotaBytes: number;
  breadcrumb: { label: string; connectorId: string; folderId: string | null }[];
  rows: Row[];
  nextCursor: string | null;
};

const otherTenantAdmin = createTestUser({
  id: 31,
  tenantId: testTenantId(9),
  roles: ["TenantAdmin"],
});
const provider = createInMemoryFileProvider();
let stack: TestStack;
let token: string;
let connectorId: string;

const view = (payload: { connectorId?: string; folderId?: string }, user = tenantAdmin) =>
  stack.http.queryOk<TreeAnswer>(ConnectorQueries.inboundFolder, payload, user);

// The default file guard checks magic bytes, so a .pdf must start like one.
const PDF_HEADER = new TextEncoder().encode("%PDF-1.4\n");
const bytesOf = (size: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(PDF_HEADER);
  return bytes;
};

beforeAll(async () => {
  stack = await setupConnectorsStack({}, undefined, provider);
  ({ token, connectorId } = await pairDevice(stack));
  for (const file of [
    { path: "Rechnungen/2026/a.pdf", bytes: bytesOf(20) },
    { path: "Rechnungen/2026/b.pdf", bytes: bytesOf(30) },
    { path: "Lieferscheine/c.pdf", bytes: bytesOf(15) },
    { path: "readme.pdf", bytes: bytesOf(12) },
  ]) {
    expect((await uploadConnectorFile(stack, token, file)).status).toBe(201);
  }
});
afterAll(() => teardownConnectorsStack(stack));

describe("file tree", () => {
  test("the root lists the device with its totals", async () => {
    const root = await view({});
    expect(root.rows).toEqual([
      {
        id: connectorId,
        kind: "device",
        name: "Office server",
        connectorId,
        folderId: null,
        fileCount: 4,
        totalBytes: 77,
        receivedAt: null,
        deleting: false,
      },
    ]);
    expect(root.usedBytes).toBe(77);
  });

  test("the device shows two folders with counted subtrees and its own file", async () => {
    const device = await view({ connectorId });
    expect(device.breadcrumb.map((crumb) => crumb.label)).toEqual(["Office server"]);
    expect(device.rows.map((row) => [row.kind, row.name, row.fileCount, row.totalBytes])).toEqual([
      ["folder", "Lieferscheine", 1, 15],
      ["folder", "Rechnungen", 2, 50],
      ["file", "readme.pdf", null, 12],
    ]);
  });

  test("a folder shows its files, subfolders and the path to it", async () => {
    const device = await view({ connectorId });
    const rechnungen = device.rows.find((row) => row.name === "Rechnungen");
    const inside = await view({ connectorId, folderId: rechnungen?.folderId ?? "" });
    expect(inside.breadcrumb.map((crumb) => crumb.label)).toEqual(["Office server", "Rechnungen"]);
    expect(inside.rows.map((row) => [row.kind, row.name, row.fileCount, row.totalBytes])).toEqual([
      ["folder", "2026", 2, 50],
    ]);
    const year = await view({ connectorId, folderId: inside.rows[0]?.folderId ?? "" });
    expect(year.rows.map((row) => row.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(
      year.rows.every(
        (row) => row.receivedAt !== null && !Number.isNaN(Date.parse(row.receivedAt)),
      ),
    ).toBe(true);
    expect(inside.rows.every((row) => row.receivedAt === null)).toBe(true);
  });

  test("another tenant sees nothing and cannot open the folder", async () => {
    expect((await view({}, otherTenantAdmin)).rows).toEqual([]);
    const res = await stack.http.query(
      ConnectorQueries.inboundFolder,
      { connectorId },
      otherTenantAdmin,
    );
    expect(res.ok).toBe(false);
  });

  test("parallel uploads into a new folder create it once", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        uploadConnectorFile(stack, token, { path: `Neu/Unter/f${n}.bin`, bytes: bytesOf(10 + n) }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual([201, 201, 201, 201]);
    const folders = await selectMany(stack.db, inboundFolderTable, {});
    expect(folders.filter((folder) => folder["parentId"] === null)).toHaveLength(3);
    expect(folders).toHaveLength(5);
  });

  test("deleting a file removes its bytes and row and lowers the used storage", async () => {
    const device = await view({ connectorId });
    const readme = device.rows.find((row) => row.name === "readme.pdf");
    const before = (await provider.list("")).length;
    await stack.http.writeOk(ConnectorHandlers.deleteFile, { id: readme?.id }, tenantAdmin);
    expect((await provider.list("")).length).toBe(before - 1);
    expect((await view({})).usedBytes).toBe(65 + 50);
  });

  test("deleting a folder removes its subtree, bytes and quota use", async () => {
    const device = await view({ connectorId });
    const rechnungen = device.rows.find((row) => row.name === "Rechnungen");
    const before = (await provider.list("")).length;
    await stack.http.writeOk(ConnectorHandlers.deleteFolder, { id: rechnungen?.id }, tenantAdmin);
    // Marked at once and named apart, but the bytes count until the sweep removed them.
    const marked = await view({ connectorId });
    expect(marked.rows.find((row) => row.name === "Rechnungen")?.deleting).toBe(true);
    expect(await view({})).toMatchObject({ usedBytes: 15 + 50 + 50, deletingBytes: 50 });
    await runConnectorJobs(stack);
    expect((await provider.list("")).length).toBe(before - 2);
    expect(await view({})).toMatchObject({ usedBytes: 15 + 50, deletingBytes: 0 });
    const after = await view({ connectorId });
    expect(after.rows.map((row) => row.name)).toEqual(["Lieferscheine", "Neu"]);
    const items = await selectMany(stack.db, inboundItemTable, {});
    expect(items).toHaveLength(5);
  });
});
