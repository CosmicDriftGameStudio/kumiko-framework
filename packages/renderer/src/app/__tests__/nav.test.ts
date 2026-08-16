// nav Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// parsePath/formatPath: plattform-neutrale URL-Grammatik mit zwei Modi
// (mit/ohne Workspaces). Pure, kein DOM.

import { describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "../feature-schema";
import { formatPath, parsePath, resolveTarget } from "../nav";

describe("parsePath — ohne Workspaces", () => {
  test("/<screenId>", () => {
    expect(parsePath("/task-list")).toEqual({ screenId: "task-list" });
  });

  test("/<screenId>/<entityId>", () => {
    expect(parsePath("/task-edit/abc-123")).toEqual({ screenId: "task-edit", entityId: "abc-123" });
  });

  test("Root und leerer Pfad → undefined", () => {
    expect(parsePath("/")).toBeUndefined();
    expect(parsePath("")).toBeUndefined();
  });

  test("überzählige Segmente werden ignoriert (kein Nesting)", () => {
    expect(parsePath("/a/b/c/d")).toEqual({ screenId: "a", entityId: "b" });
  });
});

describe("parsePath — mit Workspaces (hasWorkspaces=true)", () => {
  test("/<workspaceId>/<screenId>", () => {
    expect(parsePath("/admin/task-list", true)).toEqual({
      workspaceId: "admin",
      screenId: "task-list",
    });
  });

  test("/<workspaceId>/<screenId>/<entityId>", () => {
    expect(parsePath("/admin/task-edit/abc", true)).toEqual({
      workspaceId: "admin",
      screenId: "task-edit",
      entityId: "abc",
    });
  });

  test("Workspace-only /<workspaceId> → leerer screenId (Shell resolved Default)", () => {
    expect(parsePath("/admin", true)).toEqual({ workspaceId: "admin", screenId: "" });
  });

  test("Root / → undefined", () => {
    expect(parsePath("/", true)).toBeUndefined();
  });
});

describe("formatPath", () => {
  test("flach: /<screenId>", () => {
    expect(formatPath({ screenId: "task-list" })).toBe("/task-list");
  });

  test("mit entityId", () => {
    expect(formatPath({ screenId: "task-edit", entityId: "abc" })).toBe("/task-edit/abc");
  });

  test("mit workspaceId-Prefix", () => {
    expect(formatPath({ workspaceId: "admin", screenId: "task-list" })).toBe("/admin/task-list");
  });

  test("workspace + entity", () => {
    expect(formatPath({ workspaceId: "admin", screenId: "task-edit", entityId: "abc" })).toBe(
      "/admin/task-edit/abc",
    );
  });
});

describe("Roundtrip parsePath ↔ formatPath", () => {
  test("non-workspace", () => {
    const t = { screenId: "task-edit", entityId: "abc" };
    expect(parsePath(formatPath(t))).toEqual(t);
  });

  test("workspace", () => {
    const t = { workspaceId: "admin", screenId: "task-edit", entityId: "abc" };
    expect(parsePath(formatPath(t), true)).toEqual(t);
  });
});

// resolveTarget: ObjectTarget -> ScreenTarget lookup (fw#2163). Custom-Screen
// detailFor is the main case in app repos (projectionDetail has no entity to
// key off), so it gets its own scenario rather than piggy-backing on the
// entityList one.
function schemaWith(featureName: string, screens: readonly ScreenDefinition[]): FeatureSchema {
  return { featureName, entities: {}, screens };
}

const leaseDetailScreen: ScreenDefinition = {
  id: "lease-detail",
  type: "custom",
  renderer: { react: "stub" },
  detailFor: "lease",
};

const leaseListScreen: ScreenDefinition = {
  id: "lease-list",
  type: "entityList",
  entity: "lease",
  columns: ["name"],
};

const leaseEditScreen: ScreenDefinition = {
  id: "lease-edit",
  type: "entityEdit",
  entity: "lease",
  layout: { sections: [{ fields: ["name"] }] },
};

const leaseEditScreenAlt: ScreenDefinition = {
  id: "lease-edit-quick",
  type: "entityEdit",
  entity: "lease",
  layout: { sections: [{ fields: ["name"] }] },
};

describe("resolveTarget", () => {
  test("ScreenTarget passes through unchanged", () => {
    const target = { screenId: "task-edit", entityId: "abc" };
    expect(resolveTarget([], target)).toBe(target);
  });

  test("ObjectTarget resolves via the matching custom detailFor screen", () => {
    const schema = schemaWith("property", [leaseDetailScreen]);
    expect(resolveTarget([schema], { entity: "lease", id: "l-1" })).toEqual({
      screenId: "property:screen:lease-detail",
      entityId: "l-1",
    });
  });

  // solon's "property" entity has THREE entityEdit screens — "the" edit
  // screen for an entity isn't well-defined, so resolveTarget only ever
  // looks at detailFor. This pins that multiple same-entity entityEdit
  // screens don't confuse detail resolution (no first-match ambiguity).
  test("multiple screens on the same entity (list, two entityEdit forms, one detail) — only the detailFor screen resolves", () => {
    const schema = schemaWith("property", [
      leaseListScreen,
      leaseEditScreen,
      leaseEditScreenAlt,
      leaseDetailScreen,
    ]);
    expect(resolveTarget([schema], { entity: "lease", id: "l-1" })).toEqual({
      screenId: "property:screen:lease-detail",
      entityId: "l-1",
    });
  });

  test("workspaceId carries through when set", () => {
    const schema = schemaWith("property", [leaseDetailScreen]);
    const resolved = resolveTarget([schema], { entity: "lease", id: "l-1", workspaceId: "admin" });
    expect(resolved).toEqual({
      workspaceId: "admin",
      screenId: "property:screen:lease-detail",
      entityId: "l-1",
    });
  });

  test("workspaceId is omitted (not undefined) when not set", () => {
    const schema = schemaWith("property", [leaseDetailScreen]);
    const resolved = resolveTarget([schema], { entity: "lease", id: "l-1" });
    expect("workspaceId" in resolved).toBe(false);
  });

  test("unknown entity throws with the entity name in the message", () => {
    const schema = schemaWith("property", [leaseDetailScreen]);
    expect(() => resolveTarget([schema], { entity: "boat", id: "b-1" })).toThrow(/"boat"/);
  });
});
