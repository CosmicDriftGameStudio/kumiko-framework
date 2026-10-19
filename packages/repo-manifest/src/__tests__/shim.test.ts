import { describe, expect, test } from "bun:test";
import * as targetRoot from "@cosmicdrift/kumiko-guards/repo-manifest";
import * as targetAppPorts from "@cosmicdrift/kumiko-guards/repo-manifest/app-ports";
import * as shimAppPorts from "../app-ports/index.ts";
import * as shimRoot from "../index.ts";

describe("kumiko-repo-manifest shim", () => {
  test("root exposes the same exports as @cosmicdrift/kumiko-guards/repo-manifest", () => {
    expect(Object.keys(shimRoot).sort()).toEqual(Object.keys(targetRoot).sort());
    expect(Object.keys(shimRoot)).toContain("loadRepoManifest");
    expect(shimRoot.loadRepoManifest).toBe(targetRoot.loadRepoManifest);
  });

  test("app-ports exposes the same exports as @cosmicdrift/kumiko-guards/repo-manifest/app-ports", () => {
    expect(Object.keys(shimAppPorts).sort()).toEqual(Object.keys(targetAppPorts).sort());
    expect(Object.keys(shimAppPorts)).toContain("listAppPorts");
    expect(shimAppPorts.listAppPorts).toBe(targetAppPorts.listAppPorts);
  });
});
