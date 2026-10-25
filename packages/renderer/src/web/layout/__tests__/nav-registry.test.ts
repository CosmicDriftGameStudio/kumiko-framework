// Pure nav-registry logic tests.
//
// buildNavRegistrySlice(ForApp) qualifies feature-local nav IDs as QNs
// (feature:nav:id), applies an optional workspace allowlist, and builds
// topLevel + byParent. Pure logic; no DOM.

import { describe, expect, test } from "bun:test";
import type {
  AppSchema,
  FeatureSchema,
  NavDefinition,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveNavigation } from "../../../headless/index.ts";
import {
  filterAppSchemaNavsByAllowlist,
  reparentAppSchemaNavs,
} from "../filter-app-schema-navs.ts";
import { buildNavRegistrySlice, buildNavRegistrySliceForApp } from "../nav-tree.tsx";

function feature(navs: readonly NavDefinition[], featureName = "tasks"): FeatureSchema {
  return { featureName, entities: {}, screens: [], navs };
}

function featureWithScreens(
  navs: readonly NavDefinition[],
  screens: readonly ScreenDefinition[],
  featureName = "tasks",
): FeatureSchema {
  return { featureName, entities: {}, screens, navs };
}

describe("buildNavRegistrySlice", () => {
  test("qualifies Nav IDs to feature:nav:id", () => {
    const slice = buildNavRegistrySlice(feature([{ id: "main", label: "Main" }]));
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:main"]);
  });

  test("parent-child: child under byParent(qualified-parent), screen is qualified", () => {
    const slice = buildNavRegistrySlice(
      feature([
        { id: "main", label: "Main" },
        { id: "list", label: "List", parent: "main", screen: "task-list" },
      ]),
    );
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:main"]);
    const children = slice.byParent("tasks:nav:main");
    expect(children.map((n) => n.id)).toEqual(["tasks:nav:list"]);
    expect(children[0]?.screen).toBe("tasks:screen:task-list");
  });

  test("allowedNavQns filters out disallowed Navs", () => {
    const slice = buildNavRegistrySlice(
      feature([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ]),
      new Set(["tasks:nav:a"]),
    );
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:a"]);
  });

  test("child with a dropped parent becomes top-level (instead of disappearing)", () => {
    const slice = buildNavRegistrySlice(
      feature([
        { id: "main", label: "Main" },
        { id: "list", label: "List", parent: "main" },
      ]),
      new Set(["tasks:nav:list"]), // only the child is allowed; the parent was dropped
    );
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:list"]);
    expect(slice.byParent("tasks:nav:main")).toEqual([]);
  });
});

describe("buildNavRegistrySliceForApp", () => {
  test("child whose parent does not exist in the schema is dropped, transitively", () => {
    const app: AppSchema = {
      features: [
        feature(
          [
            { id: "group", label: "G", parent: "app-shell:nav:ai" },
            { id: "leaf", label: "L", parent: "group" },
            { id: "plain", label: "P" },
          ],
          "ai-foundation",
        ),
      ],
    };
    const slice = buildNavRegistrySliceForApp(app);
    expect(slice.topLevel.map((n) => n.id)).toEqual(["ai-foundation:nav:plain"]);
    expect(slice.byParent("ai-foundation:nav:group")).toEqual([]);
  });

  test("allowedNavQns without an existing parent on the allowlist: child surfaces top-level", () => {
    const app: AppSchema = {
      features: [
        feature([
          { id: "main", label: "Main" },
          { id: "list", label: "List", parent: "main" },
        ]),
      ],
    };
    const slice = buildNavRegistrySliceForApp(app, new Set(["tasks:nav:list"]));
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:list"]);
    expect(slice.byParent("tasks:nav:main")).toEqual([]);
  });

  test("filterAppSchemaNavsByAllowlist then slice: child of a filtered-out existing parent stays visible at top-level", () => {
    const app: AppSchema = {
      features: [
        feature([
          { id: "main", label: "Main" },
          { id: "list", label: "List", parent: "main" },
        ]),
      ],
    };
    const slice = buildNavRegistrySliceForApp(
      filterAppSchemaNavsByAllowlist(app, new Set(["tasks:nav:list"])),
    );
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:list"]);
  });

  test("qualifiziert Navs pro Feature (multi-feature)", () => {
    const app: AppSchema = {
      features: [
        feature([{ id: "catalog", label: "Catalog" }], "shop"),
        feature([{ id: "users", label: "Users" }], "admin"),
      ],
    };
    const slice = buildNavRegistrySliceForApp(app);
    expect(slice.topLevel.map((n) => n.id)).toEqual(["shop:nav:catalog", "admin:nav:users"]);
  });

  test("nav without its own access inherits access from the referenced screen", () => {
    const app: AppSchema = {
      features: [
        featureWithScreens(
          [{ id: "members", label: "Members", screen: "members" }],
          [
            {
              id: "members",
              type: "custom",
              renderer: { react: { __component: "Members" } },
              access: { roles: ["Admin"] },
            },
          ],
        ),
      ],
    };
    const slice = buildNavRegistrySliceForApp(app);
    expect(slice.topLevel[0]?.access).toEqual({ roles: ["Admin"] });
  });

  test("nav with its own access ignores the screen's access (explicit override wins)", () => {
    const app: AppSchema = {
      features: [
        featureWithScreens(
          [
            {
              id: "members",
              label: "Members",
              screen: "members",
              access: { roles: ["Admin", "Editor"] },
            },
          ],
          [
            {
              id: "members",
              type: "custom",
              renderer: { react: { __component: "Members" } },
              access: { roles: ["Admin"] },
            },
          ],
        ),
      ],
    };
    const slice = buildNavRegistrySliceForApp(app);
    expect(slice.topLevel[0]?.access).toEqual({ roles: ["Admin", "Editor"] });
  });

  test("nav without its own access remains without access when the target screen is open (does not hide an openToAll screen)", () => {
    const app: AppSchema = {
      features: [
        featureWithScreens(
          [{ id: "pub", label: "Pub", screen: "pub" }],
          [
            {
              id: "pub",
              type: "custom",
              renderer: { react: { __component: "Pub" } },
            },
          ],
        ),
      ],
    };
    const slice = buildNavRegistrySliceForApp(app);
    expect(slice.topLevel[0]?.access).toBeUndefined();
  });

  test("nav without a screen remains without access (nothing to inherit)", () => {
    const app: AppSchema = {
      features: [feature([{ id: "group", label: "Group" }])],
    };
    const slice = buildNavRegistrySliceForApp(app);
    expect(slice.topLevel[0]?.access).toBeUndefined();
  });

  test("end-to-end: resolveNavigation hides the entry from a role that is not allowed to see the target screen", () => {
    const app: AppSchema = {
      features: [
        featureWithScreens(
          [{ id: "members", label: "Members", screen: "members" }],
          [
            {
              id: "members",
              type: "custom",
              renderer: { react: { __component: "Members" } },
              access: { roles: ["Admin"] },
            },
          ],
        ),
      ],
    };
    const source = buildNavRegistrySliceForApp(app);
    const tree = resolveNavigation({ source, user: { id: "u1", roles: ["Editor"] } });
    expect(tree).toEqual([]);
  });
});

describe("nav groups across features", () => {
  const groupFeature: FeatureSchema = {
    featureName: "app-shell",
    entities: {},
    screens: [],
    navs: [{ id: "tools", label: "Tools" }],
  };

  test("a feature nav can name another feature's group as parent without any helper", () => {
    const app: AppSchema = {
      features: [
        groupFeature,
        feature(
          [{ id: "list", label: "List", parent: "app-shell:nav:tools", screen: "x" }],
          "docs",
        ),
      ],
    };
    const tree = resolveNavigation({ source: buildNavRegistrySliceForApp(app) });
    expect(tree.map((n) => n.qualifiedName)).toEqual(["app-shell:nav:tools"]);
    expect(tree[0]?.children.map((n) => n.qualifiedName)).toEqual(["docs:nav:list"]);
  });

  test("reparentAppSchemaNavs files a foreign nav under the app's group", () => {
    const app: AppSchema = {
      features: [groupFeature, feature([{ id: "list", label: "List", screen: "x" }], "docs")],
    };
    const moved = reparentAppSchemaNavs(
      app,
      new Map([["docs:nav:list", { parent: "app-shell:nav:tools", order: 1 }]]),
    );
    const tree = resolveNavigation({ source: buildNavRegistrySliceForApp(moved) });
    expect(tree.map((n) => n.qualifiedName)).toEqual(["app-shell:nav:tools"]);
    expect(tree[0]?.children.map((n) => n.qualifiedName)).toEqual(["docs:nav:list"]);
  });

  test("a group that only gets children through the allowlist reparent stays visible", () => {
    const app: AppSchema = {
      features: [
        groupFeature,
        feature(
          [
            { id: "list", label: "List", screen: "x" },
            { id: "dropped", label: "Dropped", screen: "y" },
          ],
          "docs",
        ),
      ],
    };
    const adopted = filterAppSchemaNavsByAllowlist(
      app,
      new Set(["app-shell:nav:tools", "docs:nav:list"]),
      new Map([["docs:nav:list", { parent: "app-shell:nav:tools", order: 1 }]]),
    );
    const tree = resolveNavigation({ source: buildNavRegistrySliceForApp(adopted) });
    expect(tree.map((n) => n.qualifiedName)).toEqual(["app-shell:nav:tools"]);
    expect(tree[0]?.children.map((n) => n.qualifiedName)).toEqual(["docs:nav:list"]);
  });

  test("a group whose only child is access-hidden disappears from the tree", () => {
    const app: AppSchema = {
      features: [
        groupFeature,
        feature(
          [
            {
              id: "list",
              label: "List",
              parent: "app-shell:nav:tools",
              screen: "x",
              access: { roles: ["Admin"] },
            },
          ],
          "docs",
        ),
      ],
    };
    const source = buildNavRegistrySliceForApp(app);
    expect(resolveNavigation({ source, user: { id: "u", roles: ["User"] } })).toEqual([]);
    expect(resolveNavigation({ source, user: { id: "a", roles: ["Admin"] } })).toHaveLength(1);
  });
});
