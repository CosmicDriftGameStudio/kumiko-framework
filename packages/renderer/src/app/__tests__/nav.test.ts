// nav Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// parsePath/formatPath: plattform-neutrale URL-Grammatik mit zwei Modi
// (mit/ohne Workspaces). Pure, kein DOM.

import { describe, expect, test } from "bun:test";
import { formatPath, parsePath } from "../nav";

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
