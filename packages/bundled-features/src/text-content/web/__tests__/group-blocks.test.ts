import { describe, expect, test } from "bun:test";
import type { TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { type BlockSummary, groupBlocksByFolder } from "../client-plugin";

// TreeNode.children ist `readonly TreeNode[] | TreeChildrenSubscribe` —
// im Provider-Output ist die Subscribe-Form nur für deferred-children
// gedacht, groupBlocksByFolder produziert ausschließlich statische
// Array-Children. TypeGuard statt as-Cast (Memory `[Type Assertions]`).
function childrenArray(children: TreeNode["children"] | undefined): readonly TreeNode[] {
  if (!Array.isArray(children)) throw new Error("expected static children-array");
  return children;
}
// V.1.5d-Helper: groupBlocksByFolder gibt jetzt einen "Content"-Wrapper-
// Folder zurück. Tests wollen den Inhalt UNTER dem Wrapper prüfen.
function inside(result: readonly TreeNode[]): readonly TreeNode[] {
  expect(result).toHaveLength(1);
  const wrapper = result[0];
  expect(wrapper?.label).toBe("Content");
  expect(wrapper?.icon).toBe("folder");
  return childrenArray(wrapper?.children);
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
  test("folder=null → Root-Node ohne Folder (innerhalb Content-Wrapper)", () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "imprint", folder: null })]));
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
    const nodes = inside(
      groupBlocksByFolder([block({ slug: "hero", folder: "page", title: "Hero" })]),
    );
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
    const nodes = inside(
      groupBlocksByFolder([
        block({ slug: "hero", folder: "page", title: "Hero" }),
        block({ slug: "cta", folder: "page", title: "CTA" }),
        block({ slug: "footer", folder: "page", title: "Footer" }),
      ]),
    );
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
    const nodes = inside(
      groupBlocksByFolder([
        block({ slug: "imprint", folder: null }),
        block({ slug: "hero", folder: "page" }),
        block({ slug: "cta", folder: "page" }),
      ]),
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.label).toBe("imprint");
    expect(nodes[0]?.icon).toBeUndefined();
    expect(nodes[1]?.label).toBe("page");
    expect(nodes[1]?.icon).toBe("folder");
  });
  test("Folders alphabetisch sortiert (deterministisch gegen Map-order)", () => {
    const nodes = inside(
      groupBlocksByFolder([
        block({ slug: "x", folder: "zebra" }),
        block({ slug: "y", folder: "apple" }),
        block({ slug: "z", folder: "mango" }),
      ]),
    );
    const folderLabels = nodes.map((n) => n.label);
    expect(folderLabels).toEqual(["apple", "mango", "zebra"]);
  });
  test('body=null → state="stub" (Designer-Hinweis dass Slug existiert aber leer)', () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "draft", body: null })]));
    expect(nodes[0]?.state).toBe("stub");
  });
  test('body=string → state="filled"', () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "imprint", body: "content" })]));
    expect(nodes[0]?.state).toBe("filled");
  });
  test("title leer → fallback auf slug als label", () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "untitled-block", title: "" })]));
    expect(nodes[0]?.label).toBe("untitled-block");
  });
  test('V.1.6a multi-level folder ("page/marketing") wird genested gerendert', () => {
    const nodes = inside(
      groupBlocksByFolder([block({ slug: "hero", folder: "page/marketing", title: "Hero" })]),
    );
    expect(nodes).toHaveLength(1);
    const pageFolder = nodes[0];
    expect(pageFolder?.label).toBe("page");
    expect(pageFolder?.icon).toBe("folder");
    const pageChildren = childrenArray(pageFolder?.children);
    expect(pageChildren).toHaveLength(1);
    const marketingFolder = pageChildren[0];
    expect(marketingFolder?.label).toBe("marketing");
    expect(marketingFolder?.icon).toBe("folder");
    const marketingChildren = childrenArray(marketingFolder?.children);
    expect(marketingChildren).toHaveLength(1);
    expect(marketingChildren[0]?.label).toBe("Hero");
    expect(marketingChildren[0]?.target?.args).toEqual({ slug: "hero", lang: "de" });
  });
  test("V.1.6a shared folder-prefix → ein gemeinsamer parent", () => {
    // Zwei blocks mit verschachteltem Pfad teilen die ersten Segmente.
    // page/hero + page/cta + page/marketing/banner → 1× page-folder mit
    // 3 children (2 leaves + 1 sub-folder).
    const nodes = inside(
      groupBlocksByFolder([
        block({ slug: "hero", folder: "page", title: "Hero" }),
        block({ slug: "cta", folder: "page", title: "CTA" }),
        block({ slug: "banner", folder: "page/marketing", title: "Banner" }),
      ]),
    );
    expect(nodes).toHaveLength(1);
    const pageFolder = nodes[0];
    expect(pageFolder?.label).toBe("page");
    const pageChildren = childrenArray(pageFolder?.children);
    // Leaves first (Hero, CTA), dann sub-folder (marketing alphabetisch).
    expect(pageChildren.map((c) => c.label)).toEqual(["Hero", "CTA", "marketing"]);
    expect(pageChildren[2]?.icon).toBe("folder");
    const marketingChildren = childrenArray(pageChildren[2]?.children);
    expect(marketingChildren).toHaveLength(1);
    expect(marketingChildren[0]?.label).toBe("Banner");
  });
  test("V.1.6a folder/leaf-collision: gleicher Name auf gleicher Ebene", () => {
    // Edge-Case (advisor-flagged): block mit folder=null, slug="page"
    // + block mit folder="page" → "page" existiert als Leaf-Root UND
    // als Folder. Beide bleiben sichtbar; Folder hat Chevron + Folder-
    // Icon, Leaf hat target + ist klickbar. Renderer-Pattern macht
    // visuell klar dass es zwei verschiedene Dinge sind.
    const nodes = inside(
      groupBlocksByFolder([
        block({ slug: "page", folder: null, title: "Page-Root" }),
        block({ slug: "hero", folder: "page", title: "Hero" }),
      ]),
    );
    expect(nodes).toHaveLength(2);
    const leaf = nodes[0];
    const folder = nodes[1];
    expect(leaf?.label).toBe("Page-Root");
    expect(leaf?.icon).toBeUndefined();
    expect(leaf?.target).toBeDefined();
    expect(folder?.label).toBe("page");
    expect(folder?.icon).toBe("folder");
    expect(folder?.target).toBeUndefined();
  });
  test("Wrapper-Folder 'Content' umschließt alle blocks", () => {
    // V.1.5d Wrapper-Convention: groupBlocksByFolder gibt EINEN Knoten
    // zurück (den Wrapper), Inhalt liegt eine Ebene tiefer.
    const result = groupBlocksByFolder([block({ slug: "imprint" })]);
    expect(result).toHaveLength(1);
    const wrapper = result[0];
    expect(wrapper?.label).toBe("Content");
    expect(wrapper?.icon).toBe("folder");
    expect(wrapper?.target).toBeUndefined();
    expect(childrenArray(wrapper?.children)).toHaveLength(1);
  });
});
