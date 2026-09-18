import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { NavDefinition, WorkspaceDefinition } from "../../types";
import { warnOnUnreachableNavScreens } from "../nav";
import { deriveNavAllowlistFromWorkspaces, resolveNavAllowlist } from "../workspaces";

function navMap(
  entries: ReadonlyArray<[string, NavDefinition & { readonly featureName: string }]>,
): Map<string, NavDefinition & { readonly featureName: string }> {
  return new Map(entries);
}

function workspaceMap(
  entries: ReadonlyArray<[string, WorkspaceDefinition & { readonly featureName: string }]>,
): Map<string, WorkspaceDefinition & { readonly featureName: string }> {
  return new Map(entries);
}

describe("warnOnUnreachableNavScreens", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("does not warn for an unallowlisted nav whose screen is reached by an allowlisted nav", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        {
          id: "a",
          label: "A",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:b",
        {
          id: "b",
          label: "B",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(allNavQns, new Set(["vehicles:nav:a"]));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("warns only for the unallowlisted nav whose screen nobody else reaches", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        {
          id: "a",
          label: "A",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:b",
        {
          id: "b",
          label: "B",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:c",
        {
          id: "c",
          label: "C",
          screen: "vehicles:screen:title",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(allNavQns, new Set(["vehicles:nav:a"]));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("vehicles:nav:c");
    expect(msg).toContain("vehicles");
    expect(msg).toContain("vehicles:screen:title");
  });

  test("navAllowlistExempt suppresses the warning for an exempted nav", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        {
          id: "a",
          label: "A",
          screen: "vehicles:screen:vin",
          featureName: "vehicles",
        },
      ],
      [
        "vehicles:nav:c",
        {
          id: "c",
          label: "C",
          screen: "vehicles:screen:title",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(
      allNavQns,
      new Set(["vehicles:nav:a"]),
      new Set(["vehicles:nav:c"]),
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("never warns for a nav without a screen (pure grouping entry)", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:group",
        {
          id: "group",
          label: "Group",
          featureName: "vehicles",
        },
      ],
    ]);

    warnOnUnreachableNavScreens(allNavQns, new Set());

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("resolveNavAllowlist (fw#3019 solon#113: workspace-derived allowlist)", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("does not warn for a nav listed in a workspace's nav array", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        { id: "a", label: "A", screen: "vehicles:screen:vin", featureName: "vehicles" },
      ],
    ]);
    const allWorkspaceQns = workspaceMap([
      [
        "vehicles:workspace:main",
        { id: "main", label: "Main", nav: ["vehicles:nav:a"], featureName: "vehicles" },
      ],
    ]);

    const allowlist = resolveNavAllowlist(undefined, allNavQns, allWorkspaceQns);
    warnOnUnreachableNavScreens(allNavQns, allowlist ?? new Set());

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("does not warn for a nav that self-assigns via workspaces", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        {
          id: "a",
          label: "A",
          screen: "vehicles:screen:vin",
          workspaces: ["vehicles:workspace:main"],
          featureName: "vehicles",
        },
      ],
    ]);
    const allWorkspaceQns = workspaceMap([
      ["vehicles:workspace:main", { id: "main", label: "Main", featureName: "vehicles" }],
    ]);

    const allowlist = resolveNavAllowlist(undefined, allNavQns, allWorkspaceQns);
    warnOnUnreachableNavScreens(allNavQns, allowlist ?? new Set());

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("warns for a nav in no workspace whose screen nobody else reaches (solon#113)", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        { id: "a", label: "A", screen: "vehicles:screen:vin", featureName: "vehicles" },
      ],
      [
        "vehicles:nav:orphan",
        { id: "orphan", label: "Orphan", screen: "vehicles:screen:title", featureName: "vehicles" },
      ],
    ]);
    const allWorkspaceQns = workspaceMap([
      [
        "vehicles:workspace:main",
        { id: "main", label: "Main", nav: ["vehicles:nav:a"], featureName: "vehicles" },
      ],
    ]);

    const allowlist = resolveNavAllowlist(undefined, allNavQns, allWorkspaceQns);
    warnOnUnreachableNavScreens(allNavQns, allowlist ?? new Set());

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0] as string).toContain("vehicles:nav:orphan");
  });

  test("does not warn when the app has no workspaces at all", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        { id: "a", label: "A", screen: "vehicles:screen:vin", featureName: "vehicles" },
      ],
    ]);
    const allWorkspaceQns = workspaceMap([]);

    const allowlist = resolveNavAllowlist(undefined, allNavQns, allWorkspaceQns);

    expect(allowlist).toBeUndefined();
  });

  test("an explicit navAllowlist wins over the workspace-derived one", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        { id: "a", label: "A", screen: "vehicles:screen:vin", featureName: "vehicles" },
      ],
    ]);
    const allWorkspaceQns = workspaceMap([
      [
        "vehicles:workspace:main",
        { id: "main", label: "Main", nav: ["vehicles:nav:a"], featureName: "vehicles" },
      ],
    ]);

    const allowlist = resolveNavAllowlist(new Set(), allNavQns, allWorkspaceQns);
    warnOnUnreachableNavScreens(allNavQns, allowlist ?? new Set());

    expect(allowlist).toEqual(new Set());
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0] as string).toContain("vehicles:nav:a");
  });
});

describe("deriveNavAllowlistFromWorkspaces", () => {
  test("unions workspace.nav entries and self-assigning nav.workspaces entries", () => {
    const allNavQns = navMap([
      [
        "vehicles:nav:a",
        { id: "a", label: "A", screen: "vehicles:screen:vin", featureName: "vehicles" },
      ],
      [
        "vehicles:nav:b",
        {
          id: "b",
          label: "B",
          screen: "vehicles:screen:title",
          workspaces: ["vehicles:workspace:main"],
          featureName: "vehicles",
        },
      ],
    ]);
    const allWorkspaceQns = workspaceMap([
      [
        "vehicles:workspace:main",
        { id: "main", label: "Main", nav: ["vehicles:nav:a"], featureName: "vehicles" },
      ],
    ]);

    const allowlist = deriveNavAllowlistFromWorkspaces(allNavQns, allWorkspaceQns);

    expect(allowlist).toEqual(new Set(["vehicles:nav:a", "vehicles:nav:b"]));
  });
});
