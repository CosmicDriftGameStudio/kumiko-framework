import { describe, expect, test } from "bun:test";
import { resolveRefreshIntervalMs } from "../dashboard-refresh.ts";

describe("resolveRefreshIntervalMs", () => {
  test("no refresh declared means no polling", () => {
    expect(resolveRefreshIntervalMs(undefined, { interval: 30 })).toBeUndefined();
  });

  test("seconds converts to ms without needing a record", () => {
    expect(resolveRefreshIntervalMs({ seconds: 30 }, null)).toBe(30_000);
  });

  test("seconds below the minimum is raised to 5 s", () => {
    expect(resolveRefreshIntervalMs({ seconds: 1 }, null)).toBe(5_000);
  });

  test("field reads the seconds from the record row", () => {
    expect(resolveRefreshIntervalMs({ field: "intervalSeconds" }, { intervalSeconds: 60 })).toBe(
      60_000,
    );
  });

  test("field is clamped to the 5 s minimum", () => {
    expect(resolveRefreshIntervalMs({ field: "intervalSeconds" }, { intervalSeconds: 0.5 })).toBe(
      5_000,
    );
  });

  test("field is capped to the largest value setInterval honours", () => {
    expect(
      resolveRefreshIntervalMs({ field: "intervalSeconds" }, { intervalSeconds: 10 ** 9 }),
    ).toBe(2_147_483_647);
  });

  test("field without a loaded record disables polling until it arrives", () => {
    expect(resolveRefreshIntervalMs({ field: "intervalSeconds" }, null)).toBeUndefined();
  });

  test.each([
    ["missing", {}],
    ["null", { intervalSeconds: null }],
    ["a string", { intervalSeconds: "60" }],
    ["zero", { intervalSeconds: 0 }],
    ["negative", { intervalSeconds: -5 }],
    ["NaN", { intervalSeconds: Number.NaN }],
    ["Infinity", { intervalSeconds: Number.POSITIVE_INFINITY }],
  ])("field that is %s disables polling", (_name, record) => {
    expect(resolveRefreshIntervalMs({ field: "intervalSeconds" }, record)).toBeUndefined();
  });
});
