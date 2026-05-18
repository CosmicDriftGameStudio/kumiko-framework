// @vitest-environment jsdom

import type { TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { describe, expect, test } from "vitest";
import { type BlockSummary, groupBlocksBySlugPrefix } from "../client-plugin";

// TreeNode.children ist `readonly TreeNode[] | TreeChildrenSubscribe` —
// im Provider-Output ist die Subscribe-Form nur für deferred-children
// gedacht, groupBlocksBySlugPrefix produziert ausschließlich statische
// Array-Children. TypeGuard statt as-Cast (Memory `[Type Assertions]`).
function childrenArray(children: TreeNode["children"] | undefined): readonly TreeNode[] {
  if (!Array.isArray(children)) throw new Error("expected static children-array");
  return children;
}

// Helper: BlockSummary mit defaults für die nicht-test-relevanten Felder.
function block(opts: { slug: string; body?: string | null; title?: string }): BlockSummary {
  return {
    slug: opts.slug,
    lang: "de",
    title: opts.title ?? opts.slug,
    // Nicht ?? — null soll durchgereicht werden (state="stub"-Test).
    body: opts.body === undefined ? "irgendwas" : opts.body,
    updatedAt: "2026-05-18T00:00:00Z",
  };
}

describe("groupBlocksBySlugPrefix", () => {
  test("leeres Array → leeres Array", () => {
    expect(groupBlocksBySlugPrefix([])).toEqual([]);
  });

  test("solo-slug ohne separator → Root-Node ohne Folder", () => {
    const nodes = groupBlocksBySlugPrefix([block({ slug: "imprint" })]);
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
  });

  test('slug mit ":" → Folder mit child', () => {
    const nodes = groupBlocksBySlugPrefix([block({ slug: "page:hero", title: "Hero" })]);
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
    expect(child.target?.args).toEqual({ slug: "page:hero", lang: "de" });
  });

  test('slug mit "/" → Folder mit child (gleicher Separator-Cases wie ":")', () => {
    const nodes = groupBlocksBySlugPrefix([block({ slug: "marketing/landing" })]);
    expect(nodes).toHaveLength(1);
    const folder = nodes[0];
    expect(folder).toBeDefined();
    if (!folder) return;
    expect(folder.label).toBe("marketing");
    expect(childrenArray(folder.children)).toHaveLength(1);
  });

  test("mehrere Slugs gleicher Prefix → ein Folder mit mehreren children", () => {
    const nodes = groupBlocksBySlugPrefix([
      block({ slug: "page:hero", title: "Hero" }),
      block({ slug: "page:cta", title: "CTA" }),
      block({ slug: "page:footer", title: "Footer" }),
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

  test("mixed solo + folder → beide nebeneinander", () => {
    const nodes = groupBlocksBySlugPrefix([
      block({ slug: "imprint" }),
      block({ slug: "page:hero" }),
      block({ slug: "page:cta" }),
    ]);
    expect(nodes).toHaveLength(2);
    const labels = nodes.map((n) => n.label);
    // Reihenfolge: root-nodes zuerst (in input-order), dann folder-nodes
    // (in Map-insertion-order).
    expect(labels).toContain("imprint");
    expect(labels).toContain("page");
  });

  test("verschiedene Folder-Prefixes → mehrere Folders, korrekt gruppiert", () => {
    const nodes = groupBlocksBySlugPrefix([
      block({ slug: "page:hero" }),
      block({ slug: "legal:imprint" }),
      block({ slug: "page:cta" }),
    ]);
    const folderLabels = nodes.map((n) => n.label).sort();
    expect(folderLabels).toEqual(["legal", "page"]);
    const pageFolder = nodes.find((n) => n.label === "page");
    const legalFolder = nodes.find((n) => n.label === "legal");
    expect(childrenArray(pageFolder?.children)).toHaveLength(2);
    expect(childrenArray(legalFolder?.children)).toHaveLength(1);
  });

  test('body=null → state="stub" (Designer-Hinweis dass Slug existiert aber leer)', () => {
    const nodes = groupBlocksBySlugPrefix([block({ slug: "draft", body: null })]);
    expect(nodes[0]?.state).toBe("stub");
  });

  test('body=string → state="filled"', () => {
    const nodes = groupBlocksBySlugPrefix([block({ slug: "imprint", body: "content" })]);
    expect(nodes[0]?.state).toBe("filled");
  });

  test("title leer → fallback auf slug als label", () => {
    const nodes = groupBlocksBySlugPrefix([block({ slug: "untitled-block", title: "" })]);
    expect(nodes[0]?.label).toBe("untitled-block");
  });

  test('ersten Separator splittet (slug "a:b:c" → Folder "a", child "a:b:c")', () => {
    // Memory-Pattern: search(/[:/]/) findet FIRST occurrence. Multi-
    // segment-slugs werden in V.1.2 nicht weiter zerlegt — Folder ist
    // immer single-level. Plan-doc V.1.3+ kann recursive Hierarchie
    // einführen wenn realer Bedarf zeigt.
    const nodes = groupBlocksBySlugPrefix([block({ slug: "a:b:c", title: "Deep" })]);
    expect(nodes).toHaveLength(1);
    const folder = nodes[0];
    expect(folder?.label).toBe("a");
    const children = childrenArray(folder?.children);
    expect(children).toHaveLength(1);
    expect(children[0]?.target?.args).toEqual({ slug: "a:b:c", lang: "de" });
  });
});
