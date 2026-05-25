import { describe, expect, test } from "bun:test";
import {
  clearTargetSearchParams,
  parseTargetFromSearchParams,
  serializeTarget,
} from "../target-url";

describe("serializeTarget / parseTargetFromSearchParams", () => {
  test("round-trips target + string args", () => {
    const updates = serializeTarget(
      { featureId: "text-content", action: "edit", args: { slug: "imprint", lang: "de" } },
      {},
    );
    const params = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== null) as [string, string][],
    );
    expect(parseTargetFromSearchParams(params)).toEqual({
      featureId: "text-content",
      action: "edit",
      args: { slug: "imprint", lang: "de" },
    });
  });

  test("returns undefined when t param missing", () => {
    expect(parseTargetFromSearchParams({})).toBeUndefined();
  });
});

describe("clearTargetSearchParams", () => {
  test("clears t and all a_* keys", () => {
    expect(clearTargetSearchParams({ t: "x:y", a_slug: "imprint", keep: "1" })).toEqual({
      t: null,
      a_slug: null,
    });
  });
});
