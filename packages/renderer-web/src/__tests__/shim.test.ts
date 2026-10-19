import { describe, expect, test } from "bun:test";
import * as targetRoot from "@cosmicdrift/kumiko-renderer/web";
import * as targetThemePlugin from "@cosmicdrift/kumiko-renderer/web/theme-plugin";
import * as shimRoot from "../index.ts";
import * as shimThemePlugin from "../theme-plugin.ts";

const subpaths = [
  ["root", shimRoot, targetRoot],
  ["theme-plugin", shimThemePlugin, targetThemePlugin],
] as const;

describe("kumiko-renderer-web shim", () => {
  for (const [name, shim, target] of subpaths) {
    test(`${name} exposes the same exports as @cosmicdrift/kumiko-renderer/web`, () => {
      expect(Object.keys(shim).sort()).toEqual(Object.keys(target).sort());
      expect(Object.keys(shim).length).toBeGreaterThan(0);
    });
  }

  test("re-exports the very same bindings", () => {
    expect(shimRoot.createKumikoApp).toBe(targetRoot.createKumikoApp);
    expect(shimThemePlugin.createThemePlugin).toBe(targetThemePlugin.createThemePlugin);
  });
});
