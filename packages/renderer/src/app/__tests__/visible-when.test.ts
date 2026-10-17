import { describe, expect, test } from "bun:test";
import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import type { UseQueryResult } from "../../hooks/use-query.js";
import { evalVisibleWhen, evalVisibleWhenAfterShown } from "../visible-when.js";

const gate = { query: "demo:query:state", field: "state", eq: "filled" } as const;
const refetch = async (): Promise<void> => {};
const error: DispatcherError = {
  code: "internal",
  message: "boom",
  i18nKey: "errors.internal",
  httpStatus: 500,
};

function result(
  overrides: Partial<UseQueryResult<Readonly<Record<string, unknown>>>>,
): UseQueryResult<Readonly<Record<string, unknown>>> {
  return { data: null, error: null, loading: false, refetch, ...overrides };
}

describe("evalVisibleWhen", () => {
  test("an error wins, even next to stale data", () => {
    expect(evalVisibleWhen(gate, result({ error }))).toBe("error");
    expect(evalVisibleWhen(gate, result({ error, data: { state: "filled" } }))).toBe("error");
  });

  test("no result yet is hidden", () => {
    expect(evalVisibleWhen(gate, undefined)).toBe("hidden");
  });

  test("no data while loading is loading, without loading it is hidden", () => {
    expect(evalVisibleWhen(gate, result({ loading: true }))).toBe("loading");
    expect(evalVisibleWhen(gate, result({}))).toBe("hidden");
  });

  test("data matching the gate value is visible, anything else hidden", () => {
    expect(evalVisibleWhen(gate, result({ data: { state: "filled" } }))).toBe("visible");
    expect(evalVisibleWhen(gate, result({ data: { state: "empty" } }))).toBe("hidden");
    expect(evalVisibleWhen(gate, result({ data: {} }))).toBe("hidden");
  });
});

describe("evalVisibleWhenAfterShown", () => {
  const failedAfterMatch = result({ error, data: { state: "filled" } });

  test("a failed refetch keeps shown content visible while the last good data matches", () => {
    expect(evalVisibleWhenAfterShown(gate, failedAfterMatch, true)).toBe("visible");
  });

  test("the first evaluation stays fail-closed", () => {
    expect(evalVisibleWhenAfterShown(gate, failedAfterMatch, false)).toBe("error");
  });

  test("an error without matching data is still an error", () => {
    expect(evalVisibleWhenAfterShown(gate, result({ error }), true)).toBe("error");
  });
});
