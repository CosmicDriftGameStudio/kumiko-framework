// workspace-shell Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// filterByAccess (Rollen-Filter + Sortierung), resolveDefaultId
// (preferred > default > first), firstNavScreenId (erste Nav mit Screen).
// Pure, kein DOM.

import { describe, expect, test } from "bun:test";
import type {
  AppSchema,
  WorkspaceDefinition,
  WorkspaceSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { filterByAccess, firstNavScreenId, resolveDefaultId } from "../workspace-shell";

function ws(definition: WorkspaceDefinition): WorkspaceSchema {
  return { definition, navMembers: [] };
}

describe("filterByAccess", () => {
  test("ohne access-rule immer sichtbar", () => {
    const out = filterByAccess([ws({ id: "a", label: "A" }), ws({ id: "b", label: "B" })], []);
    expect(out.map((w) => w.definition.id)).toEqual(["a", "b"]);
  });

  test("access {roles} filtert nach user-roles", () => {
    const admin = ws({ id: "admin", label: "Admin", access: { roles: ["Admin"] } });
    const open = ws({ id: "all", label: "All" });
    expect(filterByAccess([admin, open], ["Admin"]).map((w) => w.definition.id)).toEqual([
      "admin",
      "all",
    ]);
    expect(filterByAccess([admin, open], ["User"]).map((w) => w.definition.id)).toEqual(["all"]);
  });

  test("sortiert nach order (lower = earlier)", () => {
    const out = filterByAccess(
      [ws({ id: "b", label: "B", order: 2 }), ws({ id: "a", label: "A", order: 1 })],
      [],
    );
    expect(out.map((w) => w.definition.id)).toEqual(["a", "b"]);
  });
});

describe("resolveDefaultId", () => {
  test("preferred gewinnt wenn sichtbar", () => {
    expect(resolveDefaultId([ws({ id: "a", label: "A" }), ws({ id: "b", label: "B" })], "b")).toBe(
      "b",
    );
  });

  test("default-flag wenn kein preferred", () => {
    expect(
      resolveDefaultId(
        [ws({ id: "a", label: "A" }), ws({ id: "b", label: "B", default: true })],
        undefined,
      ),
    ).toBe("b");
  });

  test("erste sichtbare als Fallback", () => {
    expect(
      resolveDefaultId([ws({ id: "a", label: "A" }), ws({ id: "b", label: "B" })], undefined),
    ).toBe("a");
  });

  test("preferred nicht sichtbar → Fallback (hier: erste)", () => {
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
          { id: "header", label: "H" }, // Section-Header ohne screen
          { id: "list", label: "L", screen: "catalog" },
        ],
      },
    ],
  };

  test("erste Nav (in navMembers-Reihenfolge) mit screen → lastSegment(screen)", () => {
    expect(firstNavScreenId(app, ["shop:nav:header", "shop:nav:list"])).toBe("catalog");
  });

  test("leere oder undefined navMembers → ''", () => {
    expect(firstNavScreenId(app, [])).toBe("");
    expect(firstNavScreenId(app, undefined)).toBe("");
  });
});
