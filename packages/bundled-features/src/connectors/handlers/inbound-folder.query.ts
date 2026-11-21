import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  defineQueryHandler,
  type HandlerContext,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { FILES_PAGE_SIZE } from "../constants.ts";
import { fileNameOf } from "../path-rules.ts";
import { connectorExecutor, connectorTable } from "../schema/connector.ts";
import { inboundFolderExecutor, inboundFolderTable } from "../schema/inbound-folder.ts";
import { inboundItemExecutor, inboundItemTable } from "../schema/inbound-item.ts";
import { physicalStoredBytes, storedBytes } from "../stored-bytes.ts";

type Totals = { readonly fileCount: number; readonly totalBytes: number };
type FolderLink = { readonly id: string; readonly parentId: string | null };
type TableRow = {
  readonly id: string;
  readonly kind: "device" | "folder" | "file";
  readonly name: string;
  readonly connectorId: string;
  // Folder to open on click; null for a device (its root) and for files.
  readonly folderId: string | null;
  readonly fileCount: number | null;
  readonly totalBytes: number;
  // When the file arrived; folders and devices have none.
  readonly receivedAt: string | null;
  // The folder was sent to the deletion job; it cannot be opened or deleted again.
  readonly deleting: boolean;
};

const EMPTY_TOTALS: Totals = { fileCount: 0, totalBytes: 0 };

function addTo(map: Map<string, Totals>, key: string, add: Partial<Totals>): void {
  const current = map.get(key) ?? EMPTY_TOTALS;
  map.set(key, {
    fileCount: current.fileCount + (add.fileCount ?? 0),
    totalBytes: current.totalBytes + (add.totalBytes ?? 0),
  });
}

// Count and byte sum per folder id, computed by the database; the key null is the connector's root.
async function totalsPerFolder(
  db: HandlerContext["db"],
  where: Record<string, unknown>,
): Promise<ReadonlyMap<string | null, Totals>> {
  const groupBy = [{ field: "folderId" }];
  const [counts, sums] = await Promise.all([
    db.aggregate(inboundItemTable, { measure: { fn: "count" }, groupBy }, where),
    db.aggregate(inboundItemTable, { measure: { fn: "sum", field: "sizeBytes" }, groupBy }, where),
  ]);
  const result = new Map<string | null, Totals>();
  for (const row of counts) {
    const key = typeof row.keys[0] === "string" ? row.keys[0] : null;
    result.set(key, { fileCount: row.value ?? 0, totalBytes: 0 });
  }
  for (const row of sums) {
    const key = typeof row.keys[0] === "string" ? row.keys[0] : null;
    const current = result.get(key) ?? EMPTY_TOTALS;
    result.set(key, { ...current, totalBytes: row.value ?? 0 });
  }
  return result;
}

// The direct child of `viewId` that a folder sits under (or is), walking parentId up.
function directChildOf(
  folderId: string,
  viewId: string | null,
  byId: ReadonlyMap<string, FolderLink>,
): string | null {
  let current = byId.get(folderId);
  while (current !== undefined) {
    if (current.parentId === viewId) return current.id;
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return null;
}

export const FILE_SORT_FIELDS = ["name", "size", "received"] as const;
type FileOrder = {
  readonly field: (typeof FILE_SORT_FIELDS)[number];
  readonly direction: "asc" | "desc";
};

const SORT_COLUMN = { name: undefined, size: "sizeBytes", received: "insertedAt" } as const;

// Folders come before files whatever the order; among folders only name and size can differ.
function folderOrder(order: FileOrder) {
  const sign = order.direction === "desc" ? -1 : 1;
  return (a: TableRow, b: TableRow): number =>
    order.field === "size"
      ? sign * (a.totalBytes - b.totalBytes)
      : (order.field === "name" ? sign : 1) * a.name.localeCompare(b.name);
}

type Db = HandlerContext["db"];

async function deviceRows(db: Db): Promise<TableRow[]> {
  const [connectors, perConnector] = await Promise.all([
    selectMany<{ id: string; name: string }>(db, connectorTable, {}),
    db.aggregate(inboundItemTable, {
      measure: { fn: "count" },
      groupBy: [{ field: "connectorId" }],
    }),
  ]);
  const bytes = await db.aggregate(inboundItemTable, {
    measure: { fn: "sum", field: "sizeBytes" },
    groupBy: [{ field: "connectorId" }],
  });
  const totals = new Map<string, Totals>();
  for (const row of perConnector) {
    addTo(totals, String(row.keys[0]), { fileCount: row.value ?? 0 });
  }
  for (const row of bytes) addTo(totals, String(row.keys[0]), { totalBytes: row.value ?? 0 });
  const rows: TableRow[] = connectors.map((connector) => ({
    id: connector.id,
    kind: "device",
    name: connector.name,
    connectorId: connector.id,
    folderId: null,
    fileCount: totals.get(connector.id)?.fileCount ?? 0,
    totalBytes: totals.get(connector.id)?.totalBytes ?? 0,
    receivedAt: null,
    deleting: false,
  }));
  return rows;
}

async function subfolderRows(
  db: Db,
  user: SessionUser,
  connectorId: string,
  view: { readonly id: string; readonly idPath?: unknown } | null,
  order: FileOrder,
): Promise<TableRow[]> {
  const viewId = view ? view.id : null;
  const subtreePrefix = view ? `${String(view["idPath"])}${view.id}/` : "/";
  // ponytail: loads the ids of every folder below this one and passes them as an IN list; a share with many thousands of folders would need the sums per idPath prefix instead.
  const inScope = await selectMany<FolderLink>(
    db,
    inboundFolderTable,
    { connectorId, idPath: { startsWith: subtreePrefix } },
    { fields: ["id", "parentId"] },
  );
  const byId = new Map(inScope.map((folder) => [folder.id, folder]));
  const perFolder = await totalsPerFolder(db, {
    connectorId,
    ...(view && { folderId: { in: [view.id, ...inScope.map((folder) => folder.id)] } }),
  });
  const perChild = new Map<string, Totals>();
  for (const [id, totals] of perFolder) {
    const child = id === null || id === viewId ? null : directChildOf(id, viewId, byId);
    if (child !== null) addTo(perChild, child, totals);
  }
  const children = await inboundFolderExecutor.list(
    {
      filters: [
        { field: "connectorId", op: "eq", value: connectorId },
        { field: "parentId", op: "eq", value: viewId },
      ],
      limit: 200,
    },
    user,
    db,
  );
  const folders: TableRow[] = children.rows.map((row) => ({
    id: String(row["id"]),
    kind: "folder",
    name: String(row["name"]),
    connectorId,
    folderId: String(row["id"]),
    fileCount: perChild.get(String(row["id"]))?.fileCount ?? 0,
    totalBytes: perChild.get(String(row["id"]))?.totalBytes ?? 0,
    receivedAt: null,
    deleting: row["deleting"] === true,
  }));
  return folders.sort(folderOrder(order));
}

async function breadcrumbOf(
  db: Db,
  user: SessionUser,
  connector: { readonly id: string; readonly name: string },
  view: { readonly id: string; readonly idPath?: unknown } | null,
): Promise<{ label: string; connectorId: string; folderId: string | null }[]> {
  const namedIds = view ? [...String(view["idPath"]).split("/").filter(Boolean), view.id] : [];
  const named =
    namedIds.length === 0
      ? { rows: [] }
      : await inboundFolderExecutor.list(
          { filters: [{ field: "id", op: "in", value: namedIds }], limit: namedIds.length },
          user,
          db,
        );
  const nameOf = new Map(named.rows.map((row) => [String(row["id"]), String(row["name"])]));
  return [
    { label: connector.name, connectorId: connector.id, folderId: null },
    ...namedIds.map((id) => ({
      label: nameOf.get(id) ?? "",
      connectorId: connector.id,
      folderId: id,
    })),
  ];
}

async function filePage(
  db: Db,
  user: SessionUser,
  scope: {
    readonly connectorId: string;
    readonly viewId: string | null;
    readonly cursor: string | undefined;
    readonly order: FileOrder;
  },
): Promise<{ rows: TableRow[]; nextCursor: string | null }> {
  const { connectorId, viewId, cursor, order } = scope;
  const files = await inboundItemExecutor.list(
    {
      filters: [
        { field: "connectorId", op: "eq", value: connectorId },
        { field: "folderId", op: "eq", value: viewId },
      ],
      limit: FILES_PAGE_SIZE,
      cursor,
      sort: SORT_COLUMN[order.field],
      sortDirection: order.direction,
    },
    user,
    db,
  );
  // The name is encrypted, so the database cannot order by it: name order holds within a page only.
  // ponytail: whole-folder name order needs the names decrypted for every file; add it if a folder outgrows one page in practice.
  const sign = order.direction === "desc" ? -1 : 1;
  const pageRows =
    order.field === "name"
      ? [...files.rows].sort(
          (x, y) =>
            sign *
            fileNameOf(String(x["relativePath"])).localeCompare(
              fileNameOf(String(y["relativePath"])),
            ),
        )
      : files.rows;
  const rows: TableRow[] = pageRows.map((row) => ({
    id: String(row["id"]),
    kind: "file",
    name: fileNameOf(String(row["relativePath"])),
    connectorId,
    folderId: null,
    fileCount: null,
    totalBytes: Number(row["sizeBytes"]),
    receivedAt: String(row["insertedAt"]),
    deleting: false,
  }));
  return { rows, nextCursor: files.nextCursor };
}

export function createInboundFolderQuery(maxStoredBytes: number) {
  return defineQueryHandler({
    name: "inbound-folder",
    schema: z.object({
      connectorId: z.uuid().optional(),
      folderId: z.uuid().optional(),
      cursor: z.string().optional(),
      sort: z.enum(FILE_SORT_FIELDS).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
    }),
    access: { roles: access.admin },
    agent: { expose: false },
    description:
      "One level of the file tree the connectors delivered: without a connector the devices as top folders, otherwise the subfolders with file count and size over their whole subtree, the files directly in the folder (paged), the path to it and the storage used against the quota.",
    handler: async (query, ctx) => {
      const { connectorId, folderId, cursor } = query.payload;
      const order: FileOrder = {
        field: query.payload.sort ?? "name",
        direction: query.payload.sortDirection ?? "asc",
      };
      // The same sum the quota checks; what sits in deleting folders is named apart until the sweep removed it.
      const usedBytes = await physicalStoredBytes(ctx.db);
      const header = {
        usedBytes,
        deletingBytes: usedBytes - (await storedBytes(ctx.db)),
        quotaBytes: maxStoredBytes,
      };

      if (connectorId === undefined) {
        return { ...header, breadcrumb: [], rows: await deviceRows(ctx.db), nextCursor: null };
      }

      const connector = await connectorExecutor.detail({ id: connectorId }, query.user, ctx.db);
      if (!connector) return failNotFound("connector", connectorId);

      const view =
        folderId === undefined
          ? null
          : await inboundFolderExecutor.detail({ id: folderId }, query.user, ctx.db);
      if (folderId !== undefined && (!view || view.connectorId !== connectorId)) {
        return failNotFound("inbound-folder", folderId);
      }
      const viewId = view ? view.id : null;

      const breadcrumb = await breadcrumbOf(ctx.db, query.user, connector, view);
      const rows: TableRow[] =
        cursor === undefined
          ? await subfolderRows(ctx.db, query.user, connectorId, view, order)
          : [];

      const files = await filePage(ctx.db, query.user, { connectorId, viewId, cursor, order });
      rows.push(...files.rows);
      return { ...header, breadcrumb, rows, nextCursor: files.nextCursor };
    },
  });
}
