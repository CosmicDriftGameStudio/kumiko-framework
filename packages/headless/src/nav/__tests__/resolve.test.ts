import { describe, expect, test } from "bun:test";
import type { NavDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveNavigation } from "../resolve";
import type { NavRegistrySlice } from "../types";

// Builds the minimal NavRegistrySlice resolveNavigation consumes from a
// flat NavDefinition list. Shape matches what the framework registry
// exposes: `topLevel` collects entries without a parent, `byParent`
// looks up children by qualified parent-id. Ids in the list MUST already
// be qualified ("feature:nav:short") — that's what the registry hands
// back, so tests here mirror it 1:1.
function buildSource(navs: readonly NavDefinition[]): NavRegistrySlice {
  const byParent = new Map<string, NavDefinition[]>();
  const topLevel: NavDefinition[] = [];
  for (const nav of navs) {
    if (nav.parent) {
      const bucket = byParent.get(nav.parent);
      if (bucket) bucket.push(nav);
      else byParent.set(nav.parent, [nav]);
    } else {
      topLevel.push(nav);
    }
  }
  return {
    topLevel,
    byParent: (qn) => byParent.get(qn) ?? [],
  };
}

const userAdmin = { id: "u-admin", roles: ["Admin"] };
const userStandard = { id: "u-std", roles: ["User"] };

describe("resolveNavigation", () => {
  test("flat list: all top-level entries become root nodes", () => {
    const source = buildSource([
      { id: "orders:nav:list", label: "Orders", screen: "orders:screen:order-list" },
      { id: "orders:nav:dashboard", label: "Home" },
    ]);

    const tree = resolveNavigation({ source });

    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.qualifiedName).sort()).toEqual([
      "orders:nav:dashboard",
      "orders:nav:list",
    ]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  test("parent refs assemble the tree — one level deep", () => {
    const source = buildSource([
      { id: "app:nav:ops", label: "Operations" },
      {
        id: "app:nav:ops-orders",
        label: "Orders",
        parent: "app:nav:ops",
        screen: "orders:screen:order-list",
      },
      {
        id: "app:nav:ops-shipments",
        label: "Shipments",
        parent: "app:nav:ops",
        screen: "ship:screen:ship-list",
      },
    ]);

    const tree = resolveNavigation({ source });

    expect(tree).toHaveLength(1);
    const ops = tree[0];
    expect(ops?.qualifiedName).toBe("app:nav:ops");
    expect(ops?.children).toHaveLength(2);
    expect(ops?.children.map((c) => c.qualifiedName).sort()).toEqual([
      "app:nav:ops-orders",
      "app:nav:ops-shipments",
    ]);
  });

  test("sort order: `order` ASC, ties broken by qualifiedName alphabetic", () => {
    const source = buildSource([
      { id: "app:nav:alpha", label: "A", order: 10 },
      { id: "app:nav:beta", label: "B", order: 5 },
      { id: "app:nav:charlie", label: "C", order: 5 }, // same order as beta
    ]);

    const tree = resolveNavigation({ source });

    // beta (order=5) and charlie (order=5) first, both alphabetical, then alpha
    expect(tree.map((n) => n.qualifiedName)).toEqual([
      "app:nav:beta",
      "app:nav:charlie",
      "app:nav:alpha",
    ]);
  });

  test("access: role-gated entries drop out for non-matching users", () => {
    const source = buildSource([
      { id: "app:nav:public", label: "Public" },
      { id: "app:nav:admin-only", label: "Admin Area", access: { roles: ["Admin"] } },
    ]);

    const adminTree = resolveNavigation({ source, user: userAdmin });
    expect(adminTree.map((n) => n.qualifiedName).sort()).toEqual([
      "app:nav:admin-only",
      "app:nav:public",
    ]);

    const stdTree = resolveNavigation({ source, user: userStandard });
    expect(stdTree.map((n) => n.qualifiedName)).toEqual(["app:nav:public"]);
  });

  test("access: openToAll bypasses user-role check (matches handler-access semantic)", () => {
    const source = buildSource([
      { id: "app:nav:help", label: "Help", access: { openToAll: true } },
    ]);

    // Anonymous sees it.
    expect(resolveNavigation({ source })).toHaveLength(1);
    // Standard user sees it.
    expect(resolveNavigation({ source, user: userStandard })).toHaveLength(1);
  });

  test("access: no user + role-gated entry → dropped (anonymous can't satisfy roles)", () => {
    const source = buildSource([
      { id: "app:nav:gated", label: "Gated", access: { roles: ["Admin"] } },
    ]);

    expect(resolveNavigation({ source })).toHaveLength(0);
  });

  test("hidden parent hides descendants (no orphaned children)", () => {
    // "Reports" is Admin-only; the child "Sales Report" has no access rule
    // (would be publicly visible by itself). With the parent gone, the
    // child drops too — the resolver never recurses into a hidden node,
    // so a lone link without its containing group can't appear.
    const source = buildSource([
      { id: "app:nav:reports", label: "Reports", access: { roles: ["Admin"] } },
      {
        id: "app:nav:sales-report",
        label: "Sales",
        parent: "app:nav:reports",
        screen: "reports:screen:sales",
      },
    ]);

    const tree = resolveNavigation({ source, user: userStandard });
    expect(tree).toHaveLength(0);
  });

  test("entries pass through label/icon/screen verbatim — renderer translates label", () => {
    const source = buildSource([
      {
        id: "app:nav:orders",
        label: "orders:i18n:nav.orders",
        icon: "package",
        screen: "orders:screen:list",
        order: 1,
      },
    ]);

    const [node] = resolveNavigation({ source });
    expect(node?.label).toBe("orders:i18n:nav.orders");
    expect(node?.icon).toBe("package");
    expect(node?.screen).toBe("orders:screen:list");
    expect(node?.order).toBe(1);
  });

  test("order default is 0 on the NavNode when not provided", () => {
    const source = buildSource([{ id: "app:nav:x", label: "X" }]);
    expect(resolveNavigation({ source })[0]?.order).toBe(0);
  });

  test("dangling parent ref → child never reached (boot-validator should catch upstream)", () => {
    // "orphan" has parent="missing"; "missing" is not registered.
    // Because the walk is top-down, orphan sits only in byParent("missing")
    // and byParent is never called for "missing" (it's not in topLevel,
    // it's not reachable). So the child naturally drops.
    const source = buildSource([
      { id: "app:nav:orphan", label: "Orphan", parent: "app:nav:missing" },
    ]);

    expect(resolveNavigation({ source })).toHaveLength(0);
  });

  test("empty registry → empty tree", () => {
    const source: NavRegistrySlice = { topLevel: [], byParent: () => [] };
    expect(resolveNavigation({ source })).toEqual([]);
  });

  test("deeper nesting: three levels compose correctly", () => {
    const source = buildSource([
      { id: "a:nav:root", label: "Root" },
      { id: "a:nav:mid", label: "Mid", parent: "a:nav:root" },
      { id: "a:nav:leaf", label: "Leaf", parent: "a:nav:mid", screen: "a:screen:x" },
    ]);

    const tree = resolveNavigation({ source });
    expect(tree[0]?.qualifiedName).toBe("a:nav:root");
    expect(tree[0]?.children[0]?.qualifiedName).toBe("a:nav:mid");
    expect(tree[0]?.children[0]?.children[0]?.qualifiedName).toBe("a:nav:leaf");
  });

  // Visual-Tree-Merge: die polymorphen Felder (target/actions/createAction/
  // provider) müssen durch resolveNavigation durchgereicht werden, sonst
  // kann der eine Renderer dynamische/dispatch-Knoten nicht bauen.
  test("polymorphic fields pass through: target, actions, createAction, provider", () => {
    const editTarget = { featureId: "text-content", action: "edit", args: { slug: "hero" } };
    const createTarget = { featureId: "text-content", action: "create", args: { folder: "page" } };
    const source = buildSource([
      {
        id: "tc:nav:content",
        label: "Content",
        provider: true,
        createAction: { icon: "plus", label: "New page", target: createTarget },
      },
      {
        id: "tc:nav:hero",
        label: "Hero",
        parent: "tc:nav:content",
        target: editTarget,
        actions: [{ icon: "trash", label: "Delete", target: editTarget }],
      },
    ]);

    const tree = resolveNavigation({ source });
    const content = tree[0];
    expect(content?.provider).toBe(true);
    expect(content?.createAction?.target).toEqual(createTarget);
    const hero = content?.children[0];
    expect(hero?.target).toEqual(editTarget);
    expect(hero?.screen).toBeUndefined();
    expect(hero?.actions).toHaveLength(1);
  });

  // Knoten ohne die neuen Felder dürfen sie NICHT als undefined-Keys tragen
  // (conditional-spread): hält die resolved Node sauber + Snapshot-stabil.
  test("absent polymorphic fields are omitted, not set to undefined", () => {
    const source = buildSource([{ id: "a:nav:plain", label: "Plain", screen: "a:screen:x" }]);
    const node = resolveNavigation({ source })[0];
    expect(node).not.toBeUndefined();
    expect("target" in (node ?? {})).toBe(false);
    expect("provider" in (node ?? {})).toBe(false);
    expect("actions" in (node ?? {})).toBe(false);
  });
});
