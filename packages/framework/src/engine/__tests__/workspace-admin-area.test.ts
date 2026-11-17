import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  defineFeature,
  type NavDefinition,
  type WorkspaceDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { deriveNavAllowlistFromWorkspaces } from "../boot-validator/workspaces.ts";

const navFeature = (
  name: string,
  navs: readonly { id: string; order?: number; adminArea?: "tenant" | "platform" }[],
) =>
  defineFeature(name, (r) => {
    for (const nav of navs) {
      r.nav({ label: `${name}.${nav.id}`, screen: `${name}:screen:${nav.id}`, ...nav });
    }
  });

const hostFeature = (
  area: "tenant" | "platform" | undefined,
  explicit?: readonly string[],
  id = "host",
) =>
  defineFeature(id, (r) => {
    r.workspace({
      id: "main",
      label: "test.workspace",
      collectAdminArea: area,
      nav: explicit === undefined ? undefined : [...explicit],
    });
  });

describe("collectAdminArea", () => {
  const alpha = navFeature("alpha", [
    { id: "a-late", order: 30, adminArea: "tenant" },
    { id: "a-same", order: 10, adminArea: "tenant" },
  ]);
  const beta = navFeature("beta", [
    { id: "b-same", order: 10, adminArea: "tenant" },
    { id: "b-early", order: 5, adminArea: "tenant" },
    { id: "b-platform", order: 1, adminArea: "platform" },
    { id: "b-untagged", order: 2 },
  ]);

  test("lists tagged navs by order, ties in registration order", () => {
    const registry = createRegistry([alpha, beta, hostFeature("tenant")]);
    expect(registry.getWorkspaceNavs("host:workspace:main")).toEqual([
      "beta:nav:b-early",
      "alpha:nav:a-same",
      "beta:nav:b-same",
      "alpha:nav:a-late",
    ]);
  });

  test("explicit nav entries come first and appear once", () => {
    const registry = createRegistry([alpha, beta, hostFeature("tenant", ["alpha:nav:a-late"])]);
    expect(registry.getWorkspaceNavs("host:workspace:main")).toEqual([
      "alpha:nav:a-late",
      "beta:nav:b-early",
      "alpha:nav:a-same",
      "beta:nav:b-same",
    ]);
  });

  test("navs of another area and untagged navs are not collected", () => {
    const registry = createRegistry([alpha, beta, hostFeature("platform")]);
    expect(registry.getWorkspaceNavs("host:workspace:main")).toEqual(["beta:nav:b-platform"]);
  });

  test("a workspace without collectAdminArea stays unchanged", () => {
    const registry = createRegistry([
      alpha,
      beta,
      hostFeature(undefined, ["beta:nav:b-untagged"]),
      hostFeature("tenant", undefined, "other"),
    ]);
    expect(registry.getWorkspaceNavs("host:workspace:main")).toEqual(["beta:nav:b-untagged"]);
  });

  test("the nav allowlist contains collected navs only for collected areas", () => {
    const navDefs = new Map<string, NavDefinition & { readonly featureName: string }>([
      [
        "alpha:nav:a-same",
        { id: "a-same", label: "x", screen: "x:screen:x", adminArea: "tenant", featureName: "x" },
      ],
      [
        "beta:nav:b-platform",
        { id: "b-platform", label: "x", screen: "x:screen:x", adminArea: "platform", featureName: "x" },
      ],
    ]);
    const workspaces = new Map<string, WorkspaceDefinition & { readonly featureName: string }>([
      ["host:workspace:main", { id: "main", label: "x", collectAdminArea: "tenant", featureName: "host" }],
    ]);
    const allowlist = deriveNavAllowlistFromWorkspaces(navDefs, workspaces);
    expect(allowlist.has("alpha:nav:a-same")).toBe(true);
    expect(allowlist.has("beta:nav:b-platform")).toBe(false);
  });
});
