import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { InternalError } from "../errors/index.ts";
import { MAX_LIST_LIMIT } from "./entity-handlers.ts";

export type ListPageRequest = { readonly limit: number; readonly cursor?: string };

export type ListPage<Row> = {
  readonly rows: readonly Row[];
  readonly nextCursor?: string | null;
};

export const LIST_ALL_PAGES_DEFAULT_MAX_PAGES = 50;

export type ListAllPagesOptions = { readonly maxPages?: number };

export async function listAllPages<Row>(
  fetchPage: (request: ListPageRequest) => Promise<ListPage<Row>>,
  options: ListAllPagesOptions = {},
): Promise<Row[]> {
  const maxPages = options.maxPages ?? LIST_ALL_PAGES_DEFAULT_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new InternalError({
      message: `listAllPages: maxPages must be a whole number of at least 1, got ${maxPages}`,
    });
  }
  const rows: Row[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageCount = 1; ; pageCount++) {
    const page = await fetchPage(
      cursor === undefined ? { limit: MAX_LIST_LIMIT } : { limit: MAX_LIST_LIMIT, cursor },
    );
    rows.push(...page.rows);
    const next = page.nextCursor;
    if (next === undefined || next === null || next === "") return rows;
    // Every row lands in memory; the cap turns an unexpectedly large list into a loud failure instead of an exhausted process.
    if (pageCount >= maxPages) {
      throw new InternalError({
        message: `listAllPages: more than ${maxPages} pages of ${MAX_LIST_LIMIT} rows; pass a higher maxPages or page through the list handler yourself`,
      });
    }
    // A list handler that hands back a cursor it already returned would page forever.
    if (seenCursors.has(next)) {
      throw new InternalError({ message: `listAllPages: list handler repeated cursor ${next}` });
    }
    seenCursors.add(next);
    cursor = next;
  }
}

export function toListPage(
  value: unknown,
  source: string,
): ListPage<Readonly<Record<string, unknown>>> {
  if (!isPlainObject(value) || !Array.isArray(value["rows"])) {
    throw new InternalError({
      message: `listAllPages: ${source} did not return a { rows } list page`,
    });
  }
  const objectRows = value["rows"].filter(isPlainObject);
  if (objectRows.length !== value["rows"].length) {
    throw new InternalError({
      message: `listAllPages: ${source} returned a row that is not an object`,
    });
  }
  const nextCursor = value["nextCursor"];
  return {
    rows: objectRows,
    nextCursor: typeof nextCursor === "string" && nextCursor !== "" ? nextCursor : null,
  };
}
