import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  defineQueryHandler,
  type HandlerContext,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { MAX_SEARCH_HITS, MIN_SEARCH_TERM_LENGTH } from "../constants.ts";
import { connectorTable } from "../schema/connector.ts";
import { inboundFolderExecutor, inboundFolderTable } from "../schema/inbound-folder.ts";
import { inboundItemExecutor } from "../schema/inbound-item.ts";

type Db = HandlerContext["db"];
type FolderRef = {
  readonly id: string;
  readonly connectorId: string;
  readonly idPath: string;
};
type Hit = {
  readonly id: string;
  readonly kind: "folder" | "file";
  readonly name: string;
  readonly connectorId: string;
  // Folder to open on click: the folder itself, or the one a file sits in (null at the device root).
  readonly folderId: string | null;
  readonly path: string;
  readonly totalBytes: number;
};

const PAGE_SIZE = 200;

const matches = (name: string, needle: string): boolean => name.toLowerCase().includes(needle);

function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let at = 0; at < values.length; at += size) chunks.push(values.slice(at, at + size));
  return chunks;
}

type Budget = { remaining: number; truncated: boolean };

// Takes up to `wanted` from the budget of names this search may still decrypt.
function spend(budget: Budget, wanted: number): number {
  const granted = Math.min(wanted, budget.remaining);
  budget.remaining -= granted;
  if (granted < wanted) budget.truncated = true;
  return granted;
}

async function scopeFolders(
  db: Db,
  connectorId: string | undefined,
  view: { readonly id: string; readonly idPath: unknown } | null,
  limit: number,
): Promise<FolderRef[]> {
  const where: Record<string, unknown> = {
    ...(connectorId !== undefined && { connectorId }),
    ...(view && { idPath: { startsWith: `${String(view["idPath"])}${view.id}/` } }),
  };
  const below = await selectMany<FolderRef>(db, inboundFolderTable, where, {
    fields: ["id", "connectorId", "idPath"],
    limit,
  });
  if (!view || connectorId === undefined) return [...below];
  return [{ id: view.id, connectorId, idPath: String(view["idPath"]) }, ...below];
}

async function namesOf(
  db: Db,
  user: SessionUser,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const chunk of chunksOf(ids, PAGE_SIZE)) {
    const page = await inboundFolderExecutor.list(
      { filters: [{ field: "id", op: "in", value: chunk }], limit: chunk.length },
      user,
      db,
    );
    for (const row of page.rows) names.set(String(row["id"]), String(row["name"]));
  }
  return names;
}

function fileNameOf(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

async function fileHits(
  db: Db,
  user: SessionUser,
  scope: {
    readonly connectorId: string | undefined;
    readonly folderIds: readonly string[] | null;
    readonly needle: string;
    readonly budget: Budget;
  },
): Promise<Hit[]> {
  const hits: Hit[] = [];
  const base = scope.connectorId
    ? [{ field: "connectorId", op: "eq" as const, value: scope.connectorId }]
    : [];
  const folderChunks = scope.folderIds === null ? [null] : chunksOf(scope.folderIds, PAGE_SIZE);
  for (const chunk of folderChunks) {
    const filters =
      chunk === null ? base : [...base, { field: "folderId", op: "in" as const, value: chunk }];
    let cursor: string | undefined;
    do {
      const page = await inboundItemExecutor.list({ filters, limit: PAGE_SIZE, cursor }, user, db);
      const scanned = spend(scope.budget, page.rows.length);
      for (const row of page.rows.slice(0, scanned)) {
        const name = fileNameOf(String(row["relativePath"]));
        if (!matches(name, scope.needle)) continue;
        hits.push({
          id: String(row["id"]),
          kind: "file",
          name,
          connectorId: String(row["connectorId"]),
          folderId: typeof row["folderId"] === "string" ? row["folderId"] : null,
          path: "",
          totalBytes: Number(row["sizeBytes"]),
        });
      }
      cursor = scanned < page.rows.length ? undefined : (page.nextCursor ?? undefined);
    } while (cursor !== undefined);
  }
  return hits;
}

export function createInboundSearchQuery(maxNames: number) {
  return defineQueryHandler({
    name: "inbound-search",
    schema: z.object({
      connectorId: z.uuid().optional(),
      folderId: z.uuid().optional(),
      term: z.string().trim().min(MIN_SEARCH_TERM_LENGTH).max(100),
    }),
    access: { roles: access.admin },
    agent: { expose: false },
    description:
      "Finds folders and files by part of their name, ignoring case, in the whole tree or below one folder. The names are encrypted, so they are decrypted and scanned on the server; a search that would scan more names than the limit stops and answers `truncated`.",
    handler: async (query, ctx) => {
      const { connectorId, folderId, term } = query.payload;
      const needle = term.toLowerCase();
      const view =
        folderId === undefined
          ? null
          : await inboundFolderExecutor.detail({ id: folderId }, query.user, ctx.db);
      if (folderId !== undefined && (!view || view.connectorId !== connectorId)) {
        return failNotFound("inbound-folder", folderId);
      }

      const budget: Budget = { remaining: maxNames, truncated: false };
      const scope = await scopeFolders(ctx.db, connectorId, view, maxNames + 1);
      const scanned = spend(budget, scope.length);
      const names = await namesOf(
        ctx.db,
        query.user,
        scope.slice(0, scanned).map((folder) => folder.id),
      );
      const idPathOf = new Map(scope.map((folder) => [folder.id, folder] as const));
      const folderHits: Hit[] = [...names]
        .filter(([, name]) => matches(name, needle))
        .map(([id, name]) => ({
          id,
          kind: "folder" as const,
          name,
          connectorId: idPathOf.get(id)?.connectorId ?? "",
          folderId: id,
          path: "",
          totalBytes: 0,
        }));

      const hits = [
        ...folderHits,
        ...(await fileHits(ctx.db, query.user, {
          connectorId,
          folderIds: view ? scope.map((folder) => folder.id) : null,
          needle,
          budget,
        })),
      ];
      const shown = hits.slice(0, MAX_SEARCH_HITS);

      // Path of each hit: device name, then the names of the folders above it (a folder's own name is the hit).
      const parentsOf = (hit: Hit): string[] => {
        const own = hit.folderId === null ? undefined : idPathOf.get(hit.folderId);
        const above = own ? own.idPath.split("/").filter(Boolean) : [];
        return hit.kind === "folder"
          ? above
          : hit.folderId === null
            ? []
            : [...above, hit.folderId];
      };
      const missing = [...new Set(shown.flatMap(parentsOf))].filter((id) => !names.has(id));
      const known = new Map([...names, ...(await namesOf(ctx.db, query.user, missing))]);
      const devices = new Map(
        (await selectMany<{ id: string; name: string }>(ctx.db, connectorTable, {})).map(
          (device) => [device.id, device.name] as const,
        ),
      );
      const rows = shown.map((hit) => ({
        ...hit,
        path: [
          devices.get(hit.connectorId) ?? "",
          ...parentsOf(hit).map((id) => known.get(id) ?? ""),
        ].join(" / "),
      }));
      return { rows, truncated: budget.truncated || hits.length > MAX_SEARCH_HITS };
    },
  });
}
