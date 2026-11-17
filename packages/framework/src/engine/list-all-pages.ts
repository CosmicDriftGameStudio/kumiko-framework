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

type PagingCaller = "listAllPages" | "forEachPage";

const CAP_HINT: Readonly<Record<PagingCaller, string>> = {
  listAllPages: "pass a higher maxPages or visit the pages with forEachPage",
  forEachPage: "pass a higher maxPages",
};

async function pageThrough<Row, Stop>(
  caller: PagingCaller,
  fetchPage: (request: ListPageRequest) => Promise<ListPage<Row>>,
  visit: (rows: readonly Row[]) => Promise<Stop | undefined>,
  options: ListAllPagesOptions,
): Promise<Stop | undefined> {
  const maxPages = options.maxPages ?? LIST_ALL_PAGES_DEFAULT_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new InternalError({
      message: `${caller}: maxPages must be a whole number of at least 1, got ${maxPages}`,
    });
  }
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageCount = 1; ; pageCount++) {
    const page = await fetchPage(
      cursor === undefined ? { limit: MAX_LIST_LIMIT } : { limit: MAX_LIST_LIMIT, cursor },
    );
    const stop = await visit(page.rows);
    if (stop !== undefined) return stop;
    const next = page.nextCursor;
    if (next === undefined || next === null || next === "") return undefined;
    // listAllPages holds every row in memory and a visitor runs inside one job or transaction; the cap turns an unexpectedly long list into a loud failure instead of an exhausted process or an endless run.
    if (pageCount >= maxPages) {
      throw new InternalError({
        message: `${caller}: more than ${maxPages} pages of ${MAX_LIST_LIMIT} rows; ${CAP_HINT[caller]}`,
      });
    }
    // A list handler that hands back a cursor it already returned would page forever.
    if (seenCursors.has(next)) {
      throw new InternalError({ message: `${caller}: list handler repeated cursor ${next}` });
    }
    seenCursors.add(next);
    cursor = next;
  }
}

/** Stops paging as soon as `visit` returns anything but undefined and resolves to that value. */
export function forEachPage<Row, Stop = never>(
  fetchPage: (request: ListPageRequest) => Promise<ListPage<Row>>,
  visit: (rows: readonly Row[]) => Promise<Stop | undefined>,
  options: ListAllPagesOptions = {},
): Promise<Stop | undefined> {
  return pageThrough("forEachPage", fetchPage, visit, options);
}

export async function listAllPages<Row>(
  fetchPage: (request: ListPageRequest) => Promise<ListPage<Row>>,
  options: ListAllPagesOptions = {},
): Promise<Row[]> {
  const rows: Row[] = [];
  await pageThrough<Row, never>(
    "listAllPages",
    fetchPage,
    async (pageRows) => {
      rows.push(...pageRows);
    },
    options,
  );
  return rows;
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
