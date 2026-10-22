// List query semantics of the MockDispatcher: filters, sort, offset/cursor
// paging, totalCount and the `aggregate` answer over ALL matching rows, so
// the renderer's server-side groups and totals are tested against numbers
// the client could not have summed itself. Search stays unapplied.

import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

type Row = Readonly<Record<string, unknown>>;

type Condition = { readonly field: string; readonly op: string; readonly value: unknown };

type Measure = { readonly field: string; readonly kind: string };

export type MockQueryLogEntry = {
  readonly type: string;
  readonly aggregate: boolean;
  readonly groupBy: string | null;
  /** JSON of the payload's `filters`, for substring checks in specs. */
  readonly filters: string;
};

const QUERY_LOG: MockQueryLogEntry[] = [];
Reflect.set(globalThis, "__E2E_QUERIES__", QUERY_LOG);

// Money rows carry `{ amount, currency }` in major units; filters and
// aggregates work on minor units like the server's integer column.
const MINOR_UNITS = 100;

function moneyOf(
  value: unknown,
): { readonly minor: number; readonly currency: string } | undefined {
  if (!isPlainObject(value)) return undefined;
  const { amount, currency } = value;
  if (typeof amount !== "number" || typeof currency !== "string") return undefined;
  return { minor: Math.round(amount * MINOR_UNITS), currency };
}

function comparable(value: unknown): unknown {
  return moneyOf(value)?.minor ?? value;
}

function conditionsOf(payload: Row): Condition[] {
  const raw = [payload["filter"], ...(Array.isArray(payload["filters"]) ? payload["filters"] : [])];
  return raw.flatMap((entry): Condition[] =>
    isPlainObject(entry) && typeof entry["field"] === "string" && typeof entry["op"] === "string"
      ? [{ field: entry["field"], op: entry["op"], value: entry["value"] }]
      : [],
  );
}

function matches(row: Row, condition: Condition): boolean {
  const actual = comparable(row[condition.field]) ?? null;
  const expected = condition.value;
  switch (condition.op) {
    case "eq":
      return actual === expected;
    case "in":
      return Array.isArray(expected) && expected.some((value) => String(value) === String(actual));
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    default:
      throw new Error(`MockDispatcher: unsupported filter op "${condition.op}"`);
  }
}

function sorted(rows: readonly Row[], payload: Row): readonly Row[] {
  const field = payload["sort"];
  if (typeof field !== "string") return rows;
  const direction = payload["sortDirection"] === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = comparable(a[field]);
    const right = comparable(b[field]);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left ?? "").localeCompare(String(right ?? "")) * direction;
  });
}

function measuresOf(payload: Row): Measure[] {
  const aggregate = payload["aggregate"];
  const measures = isPlainObject(aggregate) ? aggregate["measures"] : undefined;
  return (Array.isArray(measures) ? measures : []).flatMap((entry): Measure[] =>
    isPlainObject(entry) && typeof entry["field"] === "string" && typeof entry["kind"] === "string"
      ? [{ field: entry["field"], kind: entry["kind"] }]
      : [],
  );
}

function reduce(kind: string, values: readonly number[]): number | null {
  if (kind === "count") return values.length;
  if (values.length === 0) return null;
  if (kind === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (kind === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (kind === "min") return Math.min(...values);
  if (kind === "max") return Math.max(...values);
  throw new Error(`MockDispatcher: unsupported measure kind "${kind}"`);
}

function measureValue(rows: readonly Row[], measure: Measure): unknown {
  if (measure.kind === "count") return rows.length;
  const money = rows.flatMap((row) => {
    const amount = moneyOf(row[measure.field]);
    return amount === undefined ? [] : [amount];
  });
  if (money.length > 0) {
    const currencies = [...new Set(money.map((entry) => entry.currency))].sort();
    return currencies.map((currency) => ({
      currency,
      value: reduce(
        measure.kind,
        money.filter((entry) => entry.currency === currency).map((entry) => entry.minor),
      ),
    }));
  }
  const numbers = rows.flatMap((row) => {
    const value = row[measure.field];
    return typeof value === "number" ? [value] : [];
  });
  return reduce(measure.kind, numbers);
}

function groupKeyOf(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function aggregateAnswer(rows: readonly Row[], payload: Row): unknown {
  const aggregate = payload["aggregate"];
  const groupBy = isPlainObject(aggregate) ? aggregate["groupBy"] : undefined;
  const measures = measuresOf(payload);
  const buckets = new Map<string | number | boolean | null, Row[]>();
  if (typeof groupBy !== "string") buckets.set(null, [...rows]);
  else {
    for (const row of sorted(rows, { sort: groupBy })) {
      const key = groupKeyOf(row[groupBy]);
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
  }
  return {
    groups: [...buckets].map(([key, members]) => ({
      key,
      count: members.length,
      measures: measures.map((measure) => measureValue(members, measure)),
    })),
  };
}

function offsetOf(payload: Row): number {
  const cursor = payload["cursor"];
  if (typeof cursor === "string") return Number(cursor);
  const offset = payload["offset"];
  return typeof offset === "number" ? offset : 0;
}

/** Answers `<feature>:query:<entity>:list` over the in-memory table. */
export function answerMockList(type: string, allRows: readonly Row[], payload: unknown): unknown {
  const request: Row = isPlainObject(payload) ? payload : {};
  const conditions = conditionsOf(request);
  const matching = allRows.filter((row) =>
    conditions.every((condition) => matches(row, condition)),
  );
  const aggregate = request["aggregate"];
  QUERY_LOG.push({
    type,
    aggregate: aggregate !== undefined,
    groupBy:
      isPlainObject(aggregate) && typeof aggregate["groupBy"] === "string"
        ? aggregate["groupBy"]
        : null,
    filters: JSON.stringify(request["filters"] ?? []),
  });
  if (aggregate !== undefined) return aggregateAnswer(matching, request);

  const ordered = sorted(matching, request);
  const offset = offsetOf(request);
  const limit = typeof request["limit"] === "number" ? request["limit"] : ordered.length;
  const page = ordered.slice(offset, offset + limit);
  const end = offset + page.length;
  return {
    rows: page,
    nextCursor: end < ordered.length ? String(end) : null,
    ...(request["totalCount"] === true && { total: ordered.length }),
  };
}
