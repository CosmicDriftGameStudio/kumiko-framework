import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { bookCapUsage, markCapSoftWarned } from "../book-cap-usage.js";

// Input validation runs before any ctx access, so an empty ctx proves nothing is written.
const untouchedCtx = {} as HandlerContext; // @cast-boundary test-stub

describe.each([
  ["bookCapUsage", bookCapUsage],
  ["markCapSoftWarned", markCapSoftWarned],
])("%s period validation", (_name, run) => {
  test.each(["not-a-date", "2026-05-01", ""])(
    "rejects periodStartIso %p",
    async (periodStartIso) => {
      await expect(run(untouchedCtx, { capName: "cap", periodStartIso })).rejects.toThrow();
    },
  );
});
