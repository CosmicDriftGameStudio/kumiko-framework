// Pure-logic tests for workspace-shell.
//
// filterByAccess (role filtering + sorting), resolveDefaultId
// (preferred > default > first), firstNavScreenId (first nav with a screen).
// Pure, no DOM.

import { describe, expect, test } from "bun:test";
import type {
  AppSchema,
  WorkspaceDefinition,
  WorkspaceSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { filterByAccess, firstNavScreenId, resolveDefaultId } from "../workspace-shell.tsx";

function ws(definition: WorkspaceDefinition): WorkspaceSchema {
  return { definition, navMembers: [] };
}

describe("filterByAccess", () => {
  test("without an access rule, always visible", () => {
    const out = filterByAccess([ws({ id: "a", label: "A" }), ws({ id: "b", label: "B" })], []);
    expect(out.map((w) => w.definition.id)).toEqual(["a", "b"]);
  });

  test("access {roles} filters by user roles", () => {
    const admin = ws({ id: "admin", label: "Admin", access: { roles: ["Admin"] } });
    const open = ws({ id: "all", label: "All" });
    expect(filterByAccess([admin, open], ["Admin"]).map((w) => w.definition.id)).toEqual([
      "admin",
      "all",
    ]);
    expect(filterByAccess([admin, open], ["User"]).map((w) => w.definition.id)).toEqual(["all"]);
  });

  test("sorted by order (lower = earlier)", () => {
    const out = filterByAccess(
      [ws({ id: "b", label: "B", order: 2 }), ws({ id: "a", label: "A", order: 1 })],
      [],
    );
    expect(out.map((w) => w.definition.id)).toEqual(["a", "b"]);
  });
});

describe("resolveDefaultId", () => {
  test("preferred wins when visible", () => {
    expect(resolveDefaultId([ws({ id: "a", label: "A" }), ws({ id: "b", label: "B" })], "b")).toBe(
      "b",
    );
  });

  test("default flag when no preferred", () => {
    expect(
      resolveDefaultId(
        [ws({ id: "a", label: "A" }), ws({ id: "b", label: "B", default: true })],
        undefined,
      ),
    ).toBe("b");
  });

  test("first visible as fallback", () => {
    expect(
      resolveDefaultId([ws({ id: "a", label: "A" }), ws({ id: "b", label: "B" })], undefined),
    ).toBe("a");
  });

  test("preferred not visible → fallback (here: first)", () => {
    expect(resolveDefaultId([ws({ id: "a", label: "A" })], "nonexistent")).toBe("a");
  });
});

describe("firstNavScreenId", () => {
  const app: AppSchema = {
    features: [
      {
        featureName: "shop",
        entities: {},
        screens: [],
        navs: [
          { id: "header", label: "H" }, // Section header without a screen
          { id: "list", label: "L", screen: "catalog" },
        ],
      },
    ],
  };

  test("first Nav (in navMembers order) with screen → lastSegment(screen)", () => {
    expect(firstNavScreenId(app, ["shop:nav:header", "shop:nav:list"])).toBe("catalog");
  });

  test("empty or undefined navMembers → ''", () => {
    expect(firstNavScreenId(app, [])).toBe("");
    expect(firstNavScreenId(app, undefined)).toBe("");
  });
});
