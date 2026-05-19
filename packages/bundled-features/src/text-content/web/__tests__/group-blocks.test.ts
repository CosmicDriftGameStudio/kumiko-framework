// @vitest-environment jsdom

import type { TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { describe, expect, test } from "vitest";
import { type BlockSummary, groupBlocksByFolder } from "../client-plugin";

// TreeNode.children ist `readonly TreeNode[] | TreeChildrenSubscribe` —
// im Provider-Output ist die Subscribe-Form nur für deferred-children
// gedacht, groupBlocksByFolder produziert ausschließlich statische
// Array-Children. TypeGuard statt as-Cast (Memory `[Type Assertions]`).
function childrenArray(children: TreeNode["children"] | undefined): readonly TreeNode[] {
  if (!Array.isArray(children)) throw new Error("expected static children-array");
  return children;
}

// Helper: BlockSummary mit defaults für die nicht-test-relevanten Felder.
function block(opts: {
  slug: string;
  folder?: string | null;
  body?: string | null;
  title?: string;
}): BlockSummary {
  return {
    slug: opts.slug,
    lang: "de",
    title: opts.title ?? opts.slug,
    // Nicht ?? — null soll durchgereicht werden (state="stub"-Test).
    body: opts.body === undefined ? "irgendwas" : opts.body,
    folder: opts.folder === undefined ? null : opts.folder,
    updatedAt: "2026-05-19T00:00:00Z",
  };
}

describe("groupBlocksByFolder", () => {
  test("leeres Array → leeres Array", () => {
    expect(groupBlocksByFolder([])).toEqual([]);
  });

  test("folder=null → Root-Node ohne Folder", () => {
    const nodes = groupBlocksByFolder([block({ slug: "imprint", folder: null })]);
    expect(nodes).toHaveLength(1);
    const root = nodes[0];
    expect(root).toBeDefined();
    if (!root) return;
    expect(root.label).toBe("imprint");
    expect(root.target).toEqual({
      featureId: "text-content",
      action: "edit",
      args: { slug: "imprint", lang: "de" },
    });
    expect(root.children).toBeUndefined();
    expect(root.icon).toBeUndefined();
  });

  test('folder="page" → Folder-Container mit child', () => {
    const nodes = groupBlocksByFolder([block({ slug: "hero", folder: "page", title: "Hero" })]);
    expect(nodes).toHaveLength(1);
    const folder = nodes[0];
    expect(folder).toBeDefined();
    if (!folder) return;
    expect(folder.label).toBe("page");
    expect(folder.icon).toBe("folder");
    const children = childrenArray(folder.children);
    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child).toBeDefined();
    if (!child) return;
    expect(child.label).toBe("Hero");
    expect(child.target?.args).toEqual({ slug: "hero", lang: "de" });
  });

  test("mehrere Slugs gleicher Folder → ein Folder mit mehreren children", () => {
    const nodes = groupBlocksByFolder([
      block({ slug: "hero", folder: "page", title: "Hero" }),
      block({ slug: "cta", folder: "page", title: "CTA" }),
      block({ slug: "footer", folder: "page", title: "Footer" }),
    ]);
    expect(nodes).toHaveLength(1);
    const folder = nodes[0];
    expect(folder).toBeDefined();
    if (!folder) return;
    expect(folder.label).toBe("page");
    const children = childrenArray(folder.children);
    expect(children).toHaveLength(3);
    const labels = children.map((c) => c.label);
    expect(labels).toEqual(["Hero", "CTA", "Footer"]);
  });

  test("mixed root + folder → root-nodes zuerst, dann Folders", () => {
    const nodes = groupBlocksByFolder([
      block({ slug: "imprint", folder: null }),
      block({ slug: "hero", folder: "page" }),
      block({ slug: "cta", folder: "page" }),
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.label).toBe("imprint");
    expect(nodes[0]?.icon).toBeUndefined();
    expect(nodes[1]?.label).toBe("page");
    expect(nodes[1]?.icon).toBe("folder");
  });

  test("Folders alphabetisch sortiert (deterministisch gegen Map-order)", () => {
    const nodes = groupBlocksByFolder([
      block({ slug: "x", folder: "zebra" }),
      block({ slug: "y", folder: "apple" }),
      block({ slug: "z", folder: "mango" }),
    ]);
    const folderLabels = nodes.map((n) => n.label);
    expect(folderLabels).toEqual(["apple", "mango", "zebra"]);
  });

  test('body=null → state="stub" (Designer-Hinweis dass Slug existiert aber leer)', () => {
    const nodes = groupBlocksByFolder([block({ slug: "draft", body: null })]);
    expect(nodes[0]?.state).toBe("stub");
  });

  test('body=string → state="filled"', () => {
    const nodes = groupBlocksByFolder([block({ slug: "imprint", body: "content" })]);
    expect(nodes[0]?.state).toBe("filled");
  });

  test("title leer → fallback auf slug als label", () => {
    const nodes = groupBlocksByFolder([block({ slug: "untitled-block", title: "" })]);
    expect(nodes[0]?.label).toBe("untitled-block");
  });

  test('multi-level folder ("page/marketing") wird in V.1.4 flat gerendert', () => {
    // V.1.4-Convention: folderSchema akzeptiert kebab + "/" als
    // nested-pfad, aber groupBlocksByFolder rendert flach (single-level
    // Container mit dem ganzen Pfad als Label). V.1.5 kann das splitten.
    const nodes = groupBlocksByFolder([
      block({ slug: "hero", folder: "page/marketing", title: "Hero" }),
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.label).toBe("page/marketing");
    expect(nodes[0]?.icon).toBe("folder");
  });
});
