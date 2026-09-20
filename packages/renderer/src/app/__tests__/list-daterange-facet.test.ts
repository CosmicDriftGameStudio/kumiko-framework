// fw#3104: a dateRange facet turns two calendar dates into the two query
// params it declares. The conversion is the whole risk surface — a calendar
// date has no time, `createdAt` is an instant, and "to the 14th" has to mean
// "through the end of the 14th" in the viewer's zone, not "at 00:00".

import { describe, expect, test } from "bun:test";
import type { ListFacetSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { Temporal } from "temporal-polyfill";
import {
  buildDateRangePayload,
  clampDateRange,
  readDateRange,
  resolveDateRangeFacets,
  resolveProjectionFacetSpecs,
} from "../list-facets";

const VIENNA = "Europe/Vienna";

const auditFacets: readonly ListFacetSpec[] = [
  {
    type: "dateRange",
    field: "createdAt",
    label: "audit.log.col.when",
    params: { from: "from", to: "to" },
  },
];

const specs = resolveDateRangeFacets(auditFacets, (key) => key);

function payload(
  filters: Record<string, readonly string[]>,
  timeZone = VIENNA,
): Record<string, string> {
  return buildDateRangePayload(specs, filters, timeZone);
}

describe("dateRange facet resolution", () => {
  test("resolves the declared param names, not a from/to convention", () => {
    const resolved = resolveDateRangeFacets(
      [
        {
          type: "dateRange",
          field: "occurredAt",
          label: "when",
          params: { from: "since", to: "until" },
        },
      ],
      (key) => key,
    );
    expect(resolved).toEqual([
      { field: "occurredAt", label: "when", fromParam: "since", toParam: "until" },
    ]);
  });

  test("stays out of the option-dropdown facets (no `filters` entry)", () => {
    expect(resolveProjectionFacetSpecs(auditFacets, (key) => key, "audit")).toEqual([]);
  });

  test("reads both bounds out of the shared f.<field> URL namespace", () => {
    expect(
      readDateRange(
        { "createdAt.from": ["2020-06-10"], "createdAt.to": ["2020-06-14"] },
        "createdAt",
      ),
    ).toEqual({ from: "2020-06-10", to: "2020-06-14" });
    expect(readDateRange({}, "createdAt")).toEqual({ from: "", to: "" });
  });
});

describe("dateRange facet → query params", () => {
  test("both bounds travel under the declared param names", () => {
    expect(payload({ "createdAt.from": ["2020-06-10"], "createdAt.to": ["2020-06-14"] })).toEqual({
      from: "2020-06-09T22:00:00Z",
      to: "2020-06-14T21:59:59.999999999Z",
    });
  });

  test("open interval: only `from` set sends only that param", () => {
    expect(payload({ "createdAt.from": ["2020-06-10"] })).toEqual({ from: "2020-06-09T22:00:00Z" });
  });

  test("open interval: only `to` set sends only that param", () => {
    expect(payload({ "createdAt.to": ["2020-06-14"] })).toEqual({
      to: "2020-06-14T21:59:59.999999999Z",
    });
  });

  test("no bounds set sends nothing", () => {
    expect(payload({})).toEqual({});
  });

  test("a half-typed or hand-crafted URL value is dropped, not sent", () => {
    expect(payload({ "createdAt.from": ["2020-06"], "createdAt.to": ["nonsense"] })).toEqual({});
  });

  test("bounds follow the viewer's zone", () => {
    expect(payload({ "createdAt.from": ["2020-06-10"] }, "UTC")).toEqual({
      from: "2020-06-10T00:00:00Z",
    });
  });

  test("DST: the day the clock jumps forward is still bounded by its own edges", () => {
    // 2020-03-29 is 23h long in Vienna — a naive +24h end-of-day would spill
    // an hour into the 30th.
    expect(payload({ "createdAt.from": ["2020-03-29"], "createdAt.to": ["2020-03-29"] })).toEqual({
      from: "2020-03-28T23:00:00Z",
      to: "2020-03-29T21:59:59.999999999Z",
    });
  });
});

describe("dateRange facet timezone edge (issue #3104)", () => {
  test("an event at 23:59 of the `to` day falls inside the range", () => {
    const { from, to } = payload({
      "createdAt.from": ["2020-06-14"],
      "createdAt.to": ["2020-06-14"],
    });
    if (from === undefined || to === undefined) throw new Error("expected both bounds");
    const lateEvent = Temporal.ZonedDateTime.from(`2020-06-14T23:59:00[${VIENNA}]`).toInstant();
    expect(Temporal.Instant.compare(lateEvent, Temporal.Instant.from(from))).toBeGreaterThan(0);
    // The handler filters with `lte`, so the last instant of the day counts.
    expect(Temporal.Instant.compare(lateEvent, Temporal.Instant.from(to))).toBeLessThanOrEqual(0);
  });

  test("the next day's first moment falls outside", () => {
    const { to } = payload({ "createdAt.to": ["2020-06-14"] });
    if (to === undefined) throw new Error("expected a `to` bound");
    const nextDay = Temporal.ZonedDateTime.from(`2020-06-15T00:00:00[${VIENNA}]`).toInstant();
    expect(Temporal.Instant.compare(nextDay, Temporal.Instant.from(to))).toBeGreaterThan(0);
  });
});

describe("clampDateRange keeps from <= to", () => {
  test("a `from` past the current `to` pushes `to` along", () => {
    expect(clampDateRange({ from: "2020-06-01", to: "2020-06-10" }, "from", "2020-06-20")).toEqual({
      from: "2020-06-20",
      to: "2020-06-20",
    });
  });

  test("a `to` before the current `from` pulls `from` along", () => {
    expect(clampDateRange({ from: "2020-06-10", to: "2020-06-20" }, "to", "2020-06-01")).toEqual({
      from: "2020-06-01",
      to: "2020-06-01",
    });
  });

  test("a valid bound leaves the other alone", () => {
    expect(clampDateRange({ from: "2020-06-01", to: "2020-06-20" }, "from", "2020-06-05")).toEqual({
      from: "2020-06-05",
      to: "2020-06-20",
    });
  });

  test("clearing a bound never drags the other one with it", () => {
    expect(clampDateRange({ from: "2020-06-10", to: "2020-06-20" }, "from", "")).toEqual({
      from: "",
      to: "2020-06-20",
    });
    expect(clampDateRange({ from: "2020-06-10", to: "2020-06-20" }, "to", "")).toEqual({
      from: "2020-06-10",
      to: "",
    });
  });
});
