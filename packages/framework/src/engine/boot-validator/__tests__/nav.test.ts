import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { NavDefinition } from "@cosmicdrift/kumiko-types/nav";
import type { WorkspaceDefinition } from "@cosmicdrift/kumiko-types/workspace";
import * as z from "zod";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../index.ts";
import type { BootWarning, BootWarningSink } from "../boot-warning.ts";
import { warnOnNavAccessInversion, warnOnUnreachableNavScreens } from "../nav.ts";
import { deriveNavAllowlistFromWorkspaces, resolveNavAllowlist } from "../workspaces.ts";

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
  let warnings: BootWarning[];
  const warn: BootWarningSink = (warning) => {
    warnings.push(warning);
  };

  beforeEach(() => {
    warnings = [];
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

    warnOnUnreachableNavScreens(warn, allNavQns, new Set(["vehicles:nav:a"]));

    expect(warnings).toHaveLength(0);
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

    warnOnUnreachableNavScreens(warn, allNavQns, new Set(["vehicles:nav:a"]));

    const unreachableWarnings = warnings;
    expect(unreachableWarnings).toHaveLength(1);
    const msg = unreachableWarnings[0]!.message;
    expect(msg).toContain("vehicles:nav:c");
    expect(msg).toContain("vehicles");
    expect(msg).toContain("vehicles:screen:title");
    expect(unreachableWarnings[0]).toMatchObject({
      kind: "nav/screen-unreachable",
      feature: "vehicles",
    });
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

    warnOnUnreachableNavScreens(warn, 
      allNavQns,
      new Set(["vehicles:nav:a"]),
      new Set(["vehicles:nav:c"]),
    );

    expect(warnings).toHaveLength(0);
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

    warnOnUnreachableNavScreens(warn, allNavQns, new Set());

    expect(warnings).toHaveLength(0);
  });
});

describe("warnOnUnreachableNavScreens remedy text", () => {
  let warnings: BootWarning[];
  const warn: BootWarningSink = (warning) => {
    warnings.push(warning);
  };

  beforeEach(() => {
    warnings = [];
  });

  const unreachable = navMap([
    [
      "vehicles:nav:c",
      { id: "c", label: "C", screen: "vehicles:screen:title", featureName: "vehicles" },
    ],
  ]);

  test("workspace-derived allowlist points at workspace nav assignment", () => {
    warnOnUnreachableNavScreens(warn, unreachable, new Set(), new Set(), "workspaces");

    const msg = warnings[0]!.message;
    expect(msg).toContain("add it to a workspace's `nav` array");
    expect(msg).not.toContain("add it to the allowlist");
  });

  test("explicit allowlist points at the allowlist", () => {
    warnOnUnreachableNavScreens(warn, unreachable, new Set());

    const msg = warnings[0]!.message;
    expect(msg).toContain("add it to the allowlist");
  });
});

describe("warnOnNavAccessInversion", () => {
  let warnings: BootWarning[];
  const warn: BootWarningSink = (warning) => {
    warnings.push(warning);
  };

  beforeEach(() => {
    warnings = [];
  });

  const parent: [string, NavDefinition & { readonly featureName: string }] = [
    "f:nav:p",
    { id: "p", label: "P", access: { roles: ["Admin"] }, featureName: "f" },
  ];

  test("warns for a leaf whose roles are disjoint from the parent's", () => {
    warnOnNavAccessInversion(warn, 
      navMap([
        parent,
        [
          "f:nav:l",
          { id: "l", label: "L", parent: "f:nav:p", access: { roles: ["User"] }, featureName: "f" },
        ],
      ]),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "nav/access-inversion", feature: "f" });
  });

  test("does not emit a misleading 'requires roles []' warning for an invalid openToAll leaf", () => {
    warnOnNavAccessInversion(warn, 
      navMap([
        parent,
        [
          "f:nav:l",
          {
            id: "l",
            label: "L",
            parent: "f:nav:p",
            access: { openToAll: { reason: "" } },
            featureName: "f",
          },
        ],
      ]),
    );

    expect(warnings).toHaveLength(0);
  });
});

describe("resolveNavAllowlist (workspace-derived allowlist)", () => {
  let warnings: BootWarning[];
  const warn: BootWarningSink = (warning) => {
    warnings.push(warning);
  };

  beforeEach(() => {
    warnings = [];
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
    warnOnUnreachableNavScreens(warn, allNavQns, allowlist ?? new Set());

    expect(warnings).toHaveLength(0);
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
    warnOnUnreachableNavScreens(warn, allNavQns, allowlist ?? new Set());

    expect(warnings).toHaveLength(0);
  });

  test("warns for a nav in no workspace whose screen nobody else reaches", () => {
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
    warnOnUnreachableNavScreens(warn, allNavQns, allowlist ?? new Set());

    const unreachableWarnings = warnings;
    expect(unreachableWarnings).toHaveLength(1);
    expect(unreachableWarnings[0]!.message).toContain("vehicles:nav:orphan");
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
    warnOnUnreachableNavScreens(warn, allNavQns, allowlist ?? new Set());

    expect(allowlist).toEqual(new Set());
    const unreachableWarnings = warnings;
    expect(unreachableWarnings).toHaveLength(1);
    expect(unreachableWarnings[0]!.message).toContain("vehicles:nav:a");
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

describe("validateBoot nav allowlist wiring", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function shopFeature(options: { readonly withWorkspace: boolean }) {
    return defineFeature("shop", (r) => {
      r.entity(createEntity({
          name: "item",
          fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        }));
      r.queryHandler({
        name: "item:list",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({ id: "item-list", type: "entityList", entity: "item", columns: ["title"] });
      r.screen({ id: "orphan-list", type: "entityList", entity: "item", columns: ["title"] });
      r.nav({ id: "items", label: "Items", screen: "shop:screen:item-list" });
      r.nav({ id: "orphan", label: "Orphan", screen: "shop:screen:orphan-list" });
      if (options.withWorkspace) {
        r.workspace({ id: "main", label: "Main", nav: ["shop:nav:items"] });
      }
    });
  }

  function unreachableWarnings(): unknown[][] {
    return warnSpy.mock.calls.filter(([message]) => String(message).includes("unreachable"));
  }

  test("a workspace app warns once for a nav no workspace reaches", () => {
    validateBoot(withBootValidatorFixture([shopFeature({ withWorkspace: true })]));
    const warnings = unreachableWarnings();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("shop:nav:orphan");
  });

  test("navAllowlistExempt passed to validateBoot suppresses that warning", () => {
    validateBoot(withBootValidatorFixture([shopFeature({ withWorkspace: true })]), {
      navAllowlistExempt: new Set(["shop:nav:orphan"]),
    });
    expect(unreachableWarnings()).toHaveLength(0);
  });

  test("an app without workspaces and without an allowlist does not warn", () => {
    validateBoot(withBootValidatorFixture([shopFeature({ withWorkspace: false })]));
    expect(unreachableWarnings()).toHaveLength(0);
  });
});
