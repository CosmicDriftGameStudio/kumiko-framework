import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { InternalError } from "../errors/index.ts";
import { MAX_LIST_LIMIT } from "./entity-handlers.ts";

export type ListPageRequest = { readonly limit: number; readonly cursor?: string };

export type ListPage<Row> = {
  readonly rows: readonly Row[];
  readonly nextCursor?: string | null;
};

export async function listAllPages<Row>(
  fetchPage: (request: ListPageRequest) => Promise<ListPage<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(
      cursor === undefined ? { limit: MAX_LIST_LIMIT } : { limit: MAX_LIST_LIMIT, cursor },
    );
    rows.push(...page.rows);
    const next = page.nextCursor;
    if (next === undefined || next === null || next === "") return rows;
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
