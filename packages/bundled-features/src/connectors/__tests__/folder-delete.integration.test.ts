import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorHandlers, ConnectorQueries } from "../constants.ts";
import { inboundFolderTable } from "../schema/inbound-folder.ts";
import { inboundItemTable } from "../schema/inbound-item.ts";
import {
  pairDevice,
  runDeletionJobs,
  setupConnectorsStack,
  teardownConnectorsStack,
  tenantAdmin,
  upload,
} from "./connectors-stack.ts";

type Row = {
  id: string;
  kind: "device" | "folder" | "file";
  name: string;
  totalBytes: number;
  deleting: boolean;
};
type TreeAnswer = { usedBytes: number; rows: Row[] };

const provider = createInMemoryFileProvider();
let stack: TestStack;
let token: string;
let connectorId: string;

const view = (payload: {
  connectorId?: string;
  folderId?: string;
  sort?: string;
  sortDirection?: string;
}) => stack.http.queryOk<TreeAnswer>(ConnectorQueries.inboundFolder, payload, tenantAdmin);

const PDF_HEADER = new TextEncoder().encode("%PDF-1.4\n");
const bytesOf = (size: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(PDF_HEADER);
  return bytes;
};

async function deliver(path: string, size: number): Promise<void> {
  expect((await upload(stack, token, { path, bytes: bytesOf(size) })).status).toBe(201);
}

beforeAll(async () => {
  // Batch of 10: 25 files take three batches, the loop is what the test is about.
  stack = await setupConnectorsStack({ folderDeleteBatchSize: 10 }, undefined, provider);
  ({ token, connectorId } = await pairDevice(stack));
});
afterAll(() => teardownConnectorsStack(stack));

describe("deleting a folder", () => {
  test("one call removes 25 files in a subtree in several batches, their bytes and every folder", async () => {
    for (let n = 0; n < 25; n += 1) {
      await deliver(`${["Big/a", "Big/a/b", "Big"][n % 3]}/f${n}.pdf`, 12);
    }
    await deliver("keep.pdf", 12);
    const bytesBefore = (await provider.list("")).length;
    expect(bytesBefore).toBe(26);

    const device = await view({ connectorId });
    const big = device.rows.find((row) => row.name === "Big");
    await stack.http.writeOk(ConnectorHandlers.deleteFolder, { id: big?.id }, tenantAdmin);

    expect((await view({})).usedBytes).toBe(12);
    await runDeletionJobs(stack);

    expect(await selectMany(stack.db, inboundFolderTable, {})).toHaveLength(0);
    const items = await selectMany(stack.db, inboundItemTable, {});
    expect(items).toHaveLength(1);
    expect((await provider.list("")).length).toBe(1);
    expect((await view({})).usedBytes).toBe(12);
  });

  test("an upload into a folder being deleted lands in a fresh folder", async () => {
    await deliver("Doomed/old.pdf", 10);
    const doomed = (await view({ connectorId })).rows.find((row) => row.name === "Doomed");
    await stack.http.writeOk(ConnectorHandlers.deleteFolder, { id: doomed?.id }, tenantAdmin);
    await deliver("Doomed/new.pdf", 11);
    await runDeletionJobs(stack);

    const folders = (await view({ connectorId })).rows.filter((row) => row.name === "Doomed");
    expect(folders).toHaveLength(1);
    expect(folders[0]?.id).not.toBe(doomed?.id);
    expect(folders[0]?.deleting).toBe(false);
    const inside = await view({ connectorId, folderId: folders[0]?.id });
    expect(inside.rows.map((row) => row.name)).toEqual(["new.pdf"]);
  });

  test("the same upload after the sweep recreates the folder under its derived id", async () => {
    await deliver("Again/x.pdf", 10);
    const first = (await view({ connectorId })).rows.find((row) => row.name === "Again");
    await stack.http.writeOk(ConnectorHandlers.deleteFolder, { id: first?.id }, tenantAdmin);
    await runDeletionJobs(stack);
    await deliver("Again/y.pdf", 10);
    const second = (await view({ connectorId })).rows.find((row) => row.name === "Again");
    expect(second?.deleting).toBe(false);
    expect((await view({ connectorId, folderId: second?.id })).rows.map((row) => row.name)).toEqual(
      ["y.pdf"],
    );
  });
});

describe("sorting", () => {
  test("folders stay before files and size sorts in the database", async () => {
    await deliver("Sorted/small.pdf", 10);
    await deliver("Sorted/large.pdf", 90);
    await deliver("Sorted/medium.pdf", 50);
    const folder = (await view({ connectorId })).rows.find((row) => row.name === "Sorted");
    const bySizeDesc = await view({
      connectorId,
      folderId: folder?.id,
      sort: "size",
      sortDirection: "desc",
    });
    expect(bySizeDesc.rows.map((row) => row.name)).toEqual([
      "large.pdf",
      "medium.pdf",
      "small.pdf",
    ]);
    const root = await view({ connectorId, sort: "size", sortDirection: "asc" });
    const kinds = root.rows.map((row) => row.kind);
    expect(kinds.indexOf("file")).toBeGreaterThan(kinds.lastIndexOf("folder"));
  });
});

describe("delivering again after a deletion", () => {
  test("a file deleted with its folder is stored again when it comes back unchanged", async () => {
    await deliver("Back/same.pdf", 10);
    const folder = (await view({ connectorId })).rows.find((row) => row.name === "Back");
    await stack.http.writeOk(ConnectorHandlers.deleteFolder, { id: folder?.id }, tenantAdmin);
    await runDeletionJobs(stack);
    await deliver("Back/same.pdf", 10);
    const again = (await view({ connectorId })).rows.find((row) => row.name === "Back");
    expect((await view({ connectorId, folderId: again?.id })).rows.map((row) => row.name)).toEqual([
      "same.pdf",
    ]);
  });

  test("a file deleted on its own is stored again when it comes back unchanged", async () => {
    await deliver("one.pdf", 10);
    const file = (await view({ connectorId })).rows.find((row) => row.name === "one.pdf");
    await stack.http.writeOk(ConnectorHandlers.deleteFile, { id: file?.id }, tenantAdmin);
    await deliver("one.pdf", 10);
    expect((await view({ connectorId })).rows.filter((row) => row.name === "one.pdf")).toHaveLength(
      1,
    );
  });

  test("the same file sent while its folder is being deleted is kept, not taken for a duplicate", async () => {
    await deliver("Racing/keep.pdf", 10);
    const folder = (await view({ connectorId })).rows.find((row) => row.name === "Racing");
    await stack.http.writeOk(ConnectorHandlers.deleteFolder, { id: folder?.id }, tenantAdmin);
    await deliver("Racing/keep.pdf", 10);
    await runDeletionJobs(stack);
    const fresh = (await view({ connectorId })).rows.find((row) => row.name === "Racing");
    expect((await view({ connectorId, folderId: fresh?.id })).rows.map((row) => row.name)).toEqual([
      "keep.pdf",
    ]);
  });
});

describe("quota while the deletion job has not run", () => {
  test("deleted bytes still count against the quota until the sweep removed them", async () => {
    const quotaStack = await setupConnectorsStack(
      { maxStoredBytesPerTenant: 30 },
      undefined,
      createInMemoryFileProvider(),
    );
    try {
      const paired = await pairDevice(quotaStack);
      const send = (path: string) => upload(quotaStack, paired.token, { path, bytes: bytesOf(20) });
      expect((await send("Full/a.pdf")).status).toBe(201);
      const folder = (
        await quotaStack.http.queryOk<TreeAnswer>(
          ConnectorQueries.inboundFolder,
          { connectorId: paired.connectorId },
          tenantAdmin,
        )
      ).rows.find((row) => row.name === "Full");
      await quotaStack.http.writeOk(
        ConnectorHandlers.deleteFolder,
        { id: folder?.id },
        tenantAdmin,
      );

      const blocked = await send("Other/b.pdf");
      expect(blocked.status).toBe(507);

      await runDeletionJobs(quotaStack);
      expect((await send("Other/b.pdf")).status).toBe(201);
    } finally {
      await teardownConnectorsStack(quotaStack);
    }
  });
});
