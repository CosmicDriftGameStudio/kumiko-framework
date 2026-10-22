// Driver-shaped values through coerceRow: bigint/integer/timestamptz/date branches.

import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { coerceRow } from "../../query.ts";
import type { TableInfo } from "../../table-info.ts";

function infoFor(pgTypes: Record<string, string>, bigintJsMode?: "number" | "bigint"): TableInfo {
  return {
    name: "probe",
    columnOf: (f) => f,
    pgTypeOf: (c) => pgTypes[c],
    bigintJsModeOf: () => bigintJsMode,
    fieldOf: (c) => c,
    hasColumn: () => true,
  };
}

describe("coerceRow — bigint columns", () => {
  const info = infoFor({ n: "bigint" }, "number");

  test("jsMode number: non-numeric string stays, safe bigint becomes number, unsafe stays bigint", () => {
    expect(coerceRow({ n: "abc" }, info)["n"]).toEqual("abc");
    expect(coerceRow({ n: 42n }, info)["n"]).toEqual(42);
    expect(coerceRow({ n: "9007199254740993" }, info)["n"]).toEqual(9007199254740993n);
  });

  test("without jsMode a bigint input stays the same bigint", () => {
    expect(coerceRow({ n: 42n }, infoFor({ n: "bigint" }))["n"]).toBe(42n);
  });
});

describe("coerceRow — timestamptz", () => {
  const info = infoFor({ at: "timestamptz" });

  test("unparsable string and non-string non-Date objects stay unchanged", () => {
    const object = { not: "a date" };
    expect(coerceRow({ at: "not a timestamp" }, info)["at"]).toEqual("not a timestamp");
    expect(coerceRow({ at: object }, info)["at"]).toBe(object);
  });

  test("a number becomes the Instant of those epoch milliseconds", () => {
    const at = coerceRow({ at: 1_700_000_000_000 }, info)["at"];
    expect(at).toBeInstanceOf(Temporal.Instant);
    expect((at as Temporal.Instant).epochMilliseconds).toBe(1_700_000_000_000);
  });
});

describe("coerceRow — date", () => {
  const info = infoFor({ day: "date" });

  test("values that are not a calendar day stay unchanged", () => {
    expect(coerceRow({ day: "tomorrow" }, info)["day"]).toEqual("tomorrow");
    expect(coerceRow({ day: "2024-13-45" }, info)["day"]).toEqual("2024-13-45");
    expect(coerceRow({ day: 5 }, info)["day"]).toEqual(5);
  });
});

describe("coerceRow — integer columns", () => {
  test.each(["integer", "int4", "smallint", "int2"])(
    "%s: numeric string and bigint become number",
    (pgType) => {
      const info = infoFor({ n: pgType });
      expect(coerceRow({ n: "5" }, info)["n"]).toEqual(5);
      expect(coerceRow({ n: 5n }, info)["n"]).toEqual(5);
      expect(coerceRow({ n: "x" }, info)["n"]).toEqual("x");
    },
  );
});

describe("coerceRow — identity", () => {
  test("a row where nothing changes is returned as the same object", () => {
    const row = { name: "a", n: 5 };
    const result = coerceRow(row, infoFor({ n: "integer" }));
    expect(result === row).toBe(true);
  });
});
