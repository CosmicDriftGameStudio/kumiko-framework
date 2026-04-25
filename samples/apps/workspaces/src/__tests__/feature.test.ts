// Workspaces Showcase — Unit Test (no DB / HTTP).
// Proves the framework surface that shellWorkspaces (renderer task) will
// consume:
//   - r.workspace() registers with qualified ids
//   - membership merges r.workspace.nav with r.nav.workspaces, deduped
//   - cross-feature self-assignment resolves
//   - default workspace is exposed
//   - access rule + order preserved verbatim
//   - boot-validator catches the common author mistakes

import { createRegistry, defineFeature, validateBoot } from "@kumiko/framework/engine";
import { describe, expect, test } from "vitest";
import { demoFeature, driverFeature } from "../feature";

const features = [demoFeature, driverFeature];
const registry = createRegistry(features);

describe("workspaces showcase — registry state", () => {
  test("validateBoot accepts the registered app", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("all three workspaces registered with qualified ids", () => {
    expect(registry.getWorkspace("demo:workspace:admin")?.id).toBe("demo:workspace:admin");
    expect(registry.getWorkspace("demo:workspace:dispatch")?.id).toBe("demo:workspace:dispatch");
    expect(registry.getWorkspace("demo:workspace:driver")?.id).toBe("demo:workspace:driver");
    expect(registry.getAllWorkspaces().size).toBe(3);
  });

  test("getWorkspaceFeature points back at the owning feature", () => {
    expect(registry.getWorkspaceFeature("demo:workspace:admin")).toBe("demo");
  });

  test("admin workspace stores its explicit nav list verbatim", () => {
    const admin = registry.getWorkspace("demo:workspace:admin");
    expect(admin?.nav).toEqual([
      "demo:nav:order-list",
      "demo:nav:order-edit",
      "demo:nav:audit-log",
    ]);
  });

  test("admin's resolved members merge explicit + self-assignment, deduped", () => {
    // audit-log appears in admin's explicit r.workspace.nav AND self-
    // assigns via r.nav.workspaces. The merge must include it once,
    // not twice.
    const members = registry.getWorkspaceNavs("demo:workspace:admin");
    expect(members).toEqual(["demo:nav:order-list", "demo:nav:order-edit", "demo:nav:audit-log"]);
    expect(members.filter((qn) => qn === "demo:nav:audit-log")).toHaveLength(1);
  });

  test("dispatch's resolved members come from r.nav.workspaces self-assignment", () => {
    expect(registry.getWorkspaceNavs("demo:workspace:dispatch")).toEqual(["demo:nav:order-list"]);
  });

  test("driver's resolved members include cross-feature self-assignment", () => {
    expect(registry.getWorkspaceNavs("demo:workspace:driver")).toEqual([
      "demo:nav:order-edit",
      "demo-driver:nav:my-tour",
    ]);
  });

  test("default workspace exposed once", () => {
    expect(registry.getDefaultWorkspace()?.id).toBe("demo:workspace:admin");
  });

  test("access rule + order preserved on stored definition", () => {
    const dispatch = registry.getWorkspace("demo:workspace:dispatch");
    // Role-gated — dispatcher OR admin sehen den Workspace im Switcher.
    expect(dispatch?.access).toEqual({ roles: ["Dispatcher", "Admin"] });
    expect(dispatch?.order).toBe(2);
    expect(dispatch?.icon).toBe("list");
  });

  test("workspace with no explicit nav and no self-assignments has empty resolved members", () => {
    const ws = defineFeature("ws-empty", (r) => {
      r.workspace({ id: "lonely", label: "x", access: { openToAll: true } });
    });
    const reg = createRegistry([ws]);
    expect(reg.getWorkspaceNavs("ws-empty:workspace:lonely")).toEqual([]);
  });
});

describe("workspaces — boot validation", () => {
  test("rejects non-kebab workspace id at registration time", () => {
    expect(() =>
      defineFeature("ws-bad", (r) => {
        r.workspace({ id: "BadCase", label: "x", access: { openToAll: true } });
      }),
    ).toThrow(/must be kebab-case/);
  });

  test("rejects duplicate workspace id within a feature", () => {
    expect(() =>
      defineFeature("ws-dup", (r) => {
        r.workspace({ id: "shared", label: "x", access: { openToAll: true } });
        r.workspace({ id: "shared", label: "y", access: { openToAll: true } });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects workspace whose explicit nav references a missing nav qn", () => {
    const broken = defineFeature("ws-dangling", (r) => {
      r.workspace({
        id: "ghost",
        label: "x",
        access: { openToAll: true },
        nav: ["ws-dangling:nav:does-not-exist"],
      });
    });
    expect(() => validateBoot([broken])).toThrow(/references nav .* which is not registered/);
  });

  test("rejects nav whose workspaces tag references a missing workspace qn", () => {
    const broken = defineFeature("nav-dangling", (r) => {
      r.nav({
        id: "orphan",
        label: "x",
        workspaces: ["nav-dangling:workspace:nope"],
      });
    });
    expect(() => validateBoot([broken])).toThrow(
      /self-assigns to workspace .* which is not registered/,
    );
  });

  test("rejects multiple workspaces with default: true", () => {
    const f = defineFeature("two-defaults", (r) => {
      r.workspace({ id: "a", label: "x", access: { openToAll: true }, default: true });
      r.workspace({ id: "b", label: "y", access: { openToAll: true }, default: true });
    });
    expect(() => validateBoot([f])).toThrow(/Multiple workspaces declare default: true/);
  });

  test("permits no default workspace at all", () => {
    const f = defineFeature("no-default", (r) => {
      r.workspace({ id: "a", label: "x", access: { openToAll: true } });
      r.workspace({ id: "b", label: "y", access: { openToAll: true } });
    });
    expect(() => validateBoot([f])).not.toThrow();
    const reg = createRegistry([f]);
    expect(reg.getDefaultWorkspace()).toBeUndefined();
  });
});
