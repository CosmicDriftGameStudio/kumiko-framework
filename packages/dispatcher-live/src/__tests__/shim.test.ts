import { describe, expect, test } from "bun:test";
import * as target from "@cosmicdrift/kumiko-renderer/live";
import * as shim from "../index.ts";

describe("kumiko-dispatcher-live shim", () => {
  test("exposes the same exports as @cosmicdrift/kumiko-renderer/live", () => {
    expect(Object.keys(shim).sort()).toEqual(Object.keys(target).sort());
    expect(Object.keys(shim)).toContain("createLiveDispatcher");
  });

  test("re-exports the very same bindings", () => {
    expect(shim.createLiveDispatcher).toBe(target.createLiveDispatcher);
    expect(shim.CSRF_HEADER_NAME).toBe(target.CSRF_HEADER_NAME);
  });
});
