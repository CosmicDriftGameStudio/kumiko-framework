import {
  LIST_COLUMN_PINS,
  LIST_TABLE_DENSITIES,
  type ListColumnPin,
  type ListTableDensity,
} from "@cosmicdrift/kumiko-types/screen";
import * as z from "zod";

export type StoredListColumn = { readonly field: string; readonly visible: boolean };

/** Remembered state of one list. `params` holds the list's URL parameters
 *  without the screen-id prefix (`sort`, `dir`, `q`, `page`, `size`, `f.<field>`). */
export type StoredListState = {
  readonly params?: Readonly<Record<string, string>>;
  readonly view?: {
    readonly columns?: readonly StoredListColumn[];
    readonly density?: ListTableDensity;
    readonly pins?: Readonly<Record<string, ListColumnPin>>;
    readonly widths?: Readonly<Record<string, number>>;
  };
};

const storedListStateSchema = z.object({
  params: z.record(z.string(), z.string()).optional(),
  view: z
    .object({
      columns: z.array(z.object({ field: z.string(), visible: z.boolean() })).optional(),
      density: z.enum(LIST_TABLE_DENSITIES).optional(),
      pins: z.record(z.string(), z.enum(LIST_COLUMN_PINS)).optional(),
      widths: z.record(z.string(), z.number().finite().positive()).optional(),
    })
    .optional(),
});

/** Storage boundary: anything that is not a well-formed state reads as "nothing remembered". */
export function parseStoredListState(raw: unknown): StoredListState | undefined {
  const parsed = storedListStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function parseStoredListStateJson(text: string): StoredListState | undefined {
  try {
    return parseStoredListState(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export type KnownListFields = {
  readonly columnFields: readonly string[];
  readonly filterFields: readonly string[];
};

const PLAIN_PARAM_SUFFIXES: ReadonlySet<string> = new Set(["sort", "dir", "q", "page", "size"]);
const FILTER_PREFIX = "f.";
const DATE_BOUND_SUFFIXES = [".from", ".to"] as const;

function isKnownParamSuffix(suffix: string, filterFields: ReadonlySet<string>): boolean {
  if (PLAIN_PARAM_SUFFIXES.has(suffix)) return true;
  if (!suffix.startsWith(FILTER_PREFIX)) return false;
  const filterKey = suffix.slice(FILTER_PREFIX.length);
  if (filterFields.has(filterKey)) return true;
  return DATE_BOUND_SUFFIXES.some(
    (bound) => filterKey.endsWith(bound) && filterFields.has(filterKey.slice(0, -bound.length)),
  );
}

function onKnownFields<T>(
  record: Readonly<Record<string, T>> | undefined,
  known: ReadonlySet<string>,
): Record<string, T> | undefined {
  if (record === undefined) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([field]) => known.has(field)));
}

/** Drops what the screen no longer has (renamed field, removed column) so an old
 *  session never feeds dead keys into the URL or the column picker. */
export function sanitizeStoredListState(
  raw: unknown,
  known: KnownListFields,
): StoredListState | undefined {
  const state = parseStoredListState(raw);
  if (state === undefined) return undefined;
  const filterFields = new Set(known.filterFields);
  const columnFields = new Set(known.columnFields);
  const params =
    state.params === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(state.params).filter(([suffix]) =>
            isKnownParamSuffix(suffix, filterFields),
          ),
        );
  const columns = state.view?.columns?.filter((column) => columnFields.has(column.field));
  const density = state.view?.density;
  const pins = onKnownFields(state.view?.pins, columnFields);
  const widths = onKnownFields(state.view?.widths, columnFields);
  const view = {
    ...(columns !== undefined && { columns }),
    ...(density !== undefined && { density }),
    ...(pins !== undefined && { pins }),
    ...(widths !== undefined && { widths }),
  };
  return {
    ...(params !== undefined && { params }),
    ...(state.view !== undefined && { view }),
  };
}
