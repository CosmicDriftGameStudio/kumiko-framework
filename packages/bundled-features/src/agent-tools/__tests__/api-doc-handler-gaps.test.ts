import { describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { findApiDocHandlerGaps } from "../agent-doc-lint.ts";

const OPEN_ACCESS = {
  openToAll: { reason: "test handler callable by any signed-in test user" },
} as const;

async function noop() {
  return { isSuccess: true as const, data: {} };
}

describe("findApiDocHandlerGaps", () => {
  const feature = defineFeature("gap-demo", (r) => {
    r.writeHandler({
      name: "a:undocumented",
      schema: z.object({}),
      handler: noop,
      access: OPEN_ACCESS,
    });
    r.writeHandler({
      name: "b:documented",
      schema: z.object({}),
      handler: noop,
      access: OPEN_ACCESS,
      description: "Documented.",
    });
    r.writeHandler({
      name: "c:not-listed",
      schema: z.object({}),
      handler: noop,
      access: OPEN_ACCESS,
    });
  });

  test("only handlers in the set are checked", () => {
    const gaps = findApiDocHandlerGaps(
      [feature],
      new Set(["gap-demo:write:a:undocumented", "gap-demo:write:b:documented"]),
    );
    expect(gaps.map((gap) => gap.qn)).toEqual(["gap-demo:write:a:undocumented"]);
  });

  test("an empty set yields no gaps", () => {
    expect(findApiDocHandlerGaps([feature], new Set())).toEqual([]);
  });
});
