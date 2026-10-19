import { describe, expect, test } from "bun:test";
import * as targetRoot from "@cosmicdrift/kumiko-renderer/headless";
import * as targetApex from "@cosmicdrift/kumiko-renderer/headless/apex";
import * as targetDispatcher from "@cosmicdrift/kumiko-renderer/headless/dispatcher";
import * as targetLocaleRouting from "@cosmicdrift/kumiko-renderer/headless/locale-routing";
import * as shimApex from "../apex/index.ts";
import * as shimDispatcher from "../dispatcher/index.ts";
import * as shimRoot from "../index.ts";
import * as shimLocaleRouting from "../locale-routing/index.ts";

const subpaths = [
  ["root", shimRoot, targetRoot],
  ["dispatcher", shimDispatcher, targetDispatcher],
  ["apex", shimApex, targetApex],
  ["locale-routing", shimLocaleRouting, targetLocaleRouting],
] as const;

describe("kumiko-headless shim", () => {
  for (const [name, shim, target] of subpaths) {
    test(`${name} exposes the same exports as @cosmicdrift/kumiko-renderer/headless`, () => {
      expect(Object.keys(shim).sort()).toEqual(Object.keys(target).sort());
      expect(Object.keys(shim).length).toBeGreaterThan(0);
    });
  }

  test("re-exports the very same bindings", () => {
    expect(shimRoot.createStore).toBe(targetRoot.createStore);
    expect(shimDispatcher.StreamFrame).toBe(targetDispatcher.StreamFrame);
  });
});
