import { describe, expect, test } from "bun:test";
import * as target from "@cosmicdrift/kumiko-framework/http";
import * as shim from "../index.ts";

describe("kumiko-http shim", () => {
  test("exposes the same exports as @cosmicdrift/kumiko-framework/http", () => {
    expect(Object.keys(shim).sort()).toEqual(Object.keys(target).sort());
    expect(Object.keys(shim)).toContain("egress");
  });

  test("re-exports the very same bindings", () => {
    expect(shim.egress).toBe(target.egress);
    expect(shim.BlockedHostError).toBe(target.BlockedHostError);
  });
});
