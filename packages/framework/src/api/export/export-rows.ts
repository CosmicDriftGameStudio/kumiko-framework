import { MAX_LIST_LIMIT } from "../../engine/entity-handlers.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { InternalError } from "../../errors/index.ts";
import type { Dispatcher } from "../../pipeline/dispatcher.ts";
import { isPlainObject } from "../../utils/is-plain-object.ts";
import type { ExportPlan } from "./export-screen.ts";

export type ExportRow = Readonly<Record<string, unknown>>;

export type ExportRowsResult =
  | { readonly tooMany: false; readonly rows: readonly ExportRow[] }
  | { readonly tooMany: true };

// Paging, sizing and aggregation belong to the server here; `filter` is replaced from the screen
// below, so a client can neither widen the fixed screen filter nor smuggle another one in.
const CLIENT_CONTROLLED_PAGING_KEYS = [
  "limit",
  "offset",
  "cursor",
  "totalCount",
  "aggregate",
  "includeDeleted",
  "filter",
] as const;

export function sanitizeExportPayload(
  clientPayload: Readonly<Record<string, unknown>>,
  plan: Pick<ExportPlan, "screenFilter">,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...clientPayload };
  for (const key of CLIENT_CONTROLLED_PAGING_KEYS) delete payload[key];
  if (plan.screenFilter !== undefined) payload["filter"] = plan.screenFilter;
  return payload;
}

type Page = { readonly rows: readonly ExportRow[]; readonly nextCursor: string | undefined };

function parsePage(result: unknown, queryType: string): Page {
  if (!isPlainObject(result) || !Array.isArray(result["rows"])) {
    throw new InternalError({
      message: `export: query ${queryType} did not return a { rows } envelope`,
    });
  }
  const nextCursor = result["nextCursor"];
  return {
    rows: result["rows"].filter(isPlainObject),
    nextCursor: typeof nextCursor === "string" && nextCursor !== "" ? nextCursor : undefined,
  };
}

/** Reads the whole filtered list page by page; gives up as soon as more than `maxRows` exist. */
export async function readExportRows(
  dispatcher: Pick<Dispatcher, "query">,
  plan: ExportPlan,
  clientPayload: Readonly<Record<string, unknown>>,
  user: SessionUser,
): Promise<ExportRowsResult> {
  const base = sanitizeExportPayload(clientPayload, plan);
  const rows: ExportRow[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const limit = Math.min(MAX_LIST_LIMIT, plan.maxRows + 1 - rows.length);
    const pagingPayload =
      cursor !== undefined
        ? { ...base, limit, cursor }
        : rows.length > 0
          ? { ...base, limit, offset: rows.length }
          : { ...base, limit };
    const page = parsePage(
      await dispatcher.query(plan.queryType, pagingPayload, user),
      plan.queryType,
    );
    rows.push(...page.rows);
    if (rows.length > plan.maxRows) return { tooMany: true };
    // A short or empty page is the end of the list; a repeated cursor would loop forever.
    if (page.rows.length < limit || page.rows.length === 0) return { tooMany: false, rows };
    if (page.nextCursor !== undefined) {
      if (seenCursors.has(page.nextCursor)) return { tooMany: false, rows };
      seenCursors.add(page.nextCursor);
    }
    cursor = page.nextCursor;
  }
}
