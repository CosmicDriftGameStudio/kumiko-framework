import { describe, expect, test } from "bun:test";
import type { TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { type BlockSummary, groupBlocksByFolder } from "../content-tree-provider.ts";

// TreeNode.children is `readonly TreeNode[] | TreeChildrenSubscribe` —
// in the provider output, the subscribe form is only meant for
// deferred children; groupBlocksByFolder produces exclusively static
// array children. A type guard instead of an as-cast.
function childrenArray(children: TreeNode["children"] | undefined): readonly TreeNode[] {
  if (!Array.isArray(children)) throw new Error("expected static children-array");
  return children;
}
// Helper: groupBlocksByFolder now returns a single "Content" wrapper
// folder. Tests want to check the content UNDER the wrapper.
function inside(result: readonly TreeNode[]): readonly TreeNode[] {
  expect(result).toHaveLength(1);
  const wrapper = result[0];
  expect(wrapper?.label).toBe("Content");
  expect(wrapper?.icon).toBe("folder");
  return childrenArray(wrapper?.children);
}
// Helper: BlockSummary with defaults for the fields not relevant to the test.
function block(opts: {
  slug: string;
  folder?: string | null;
  content?: string | null;
  title?: string;
}): BlockSummary {
  return {
    slug: opts.slug,
    locale: "de",
    title: opts.title ?? opts.slug,
    // Not ?? — null should be passed through (state="stub" test).
    content: opts.content === undefined ? "irgendwas" : opts.content,
    folder: opts.folder === undefined ? null : opts.folder,
    modifiedAt: "2026-05-19T00:00:00Z",
  };
}
describe("groupBlocksByFolder", () => {
  test("leeres Array → leeres Array", () => {
    expect(groupBlocksByFolder([])).toEqual([]);
  });
  test("folder=null → Root node without Folder (inside Content wrapper)", () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "imprint", folder: null })]));
    expect(nodes).toHaveLength(1);
    const root = nodes[0];
    expect(root).toBeDefined();
    if (!root) return;
    expect(root.label).toBe("imprint");
    expect(root.target).toEqual({
      featureId: "template-resolver",
      action: "edit",
      args: { slug: "imprint", locale: "de" },
    });
    expect(root.children).toBeUndefined();
    expect(root.icon).toBe("file");
  });
  test('folder="page" → Folder container with child', () => {
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
    expect(child.target?.args).toEqual({ slug: "hero", locale: "de" });
  });
  test("multiple slugs in the same Folder → one Folder with multiple children", () => {
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
  test("mixed root + folder → root nodes first, then Folders", () => {
    const nodes = inside(
      groupBlocksByFolder([
        block({ slug: "imprint", folder: null }),
        block({ slug: "hero", folder: "page" }),
        block({ slug: "cta", folder: "page" }),
      ]),
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.label).toBe("imprint");
    expect(nodes[0]?.icon).toBe("file");
    expect(nodes[1]?.label).toBe("page");
    expect(nodes[1]?.icon).toBe("folder");
  });
  test("Folders sorted alphabetically (deterministic regardless of Map order)", () => {
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
  test('content=null → state="stub" (Designer hint that the slug exists but is empty)', () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "draft", content: null })]));
    expect(nodes[0]?.state).toBe("stub");
  });
  test('content=string → state="filled"', () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "imprint", content: "content" })]));
    expect(nodes[0]?.state).toBe("filled");
  });
  test("title empty → fallback to slug as label", () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "untitled-block", title: "" })]));
    expect(nodes[0]?.label).toBe("untitled-block");
  });
  test('V.1.6a multi-level folder ("page/marketing") is rendered nested', () => {
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
    expect(marketingChildren[0]?.target?.args).toEqual({ slug: "hero", locale: "de" });
  });
  test("shared folder prefix → one shared parent", () => {
    // Two blocks with a nested path share the first segments.
    // page/hero + page/cta + page/marketing/banner → 1× page folder with
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
    // Leaves first (Hero, CTA), then sub-folder (marketing alphabetically).
    expect(pageChildren.map((c) => c.label)).toEqual(["Hero", "CTA", "marketing"]);
    expect(pageChildren[2]?.icon).toBe("folder");
    const marketingChildren = childrenArray(pageChildren[2]?.children);
    expect(marketingChildren).toHaveLength(1);
    expect(marketingChildren[0]?.label).toBe("Banner");
  });
  test("folder/leaf collision: same name at the same level", () => {
    // Edge case (advisor-flagged): block with folder=null, slug="page"
    // + block with folder="page" → "page" exists both as a leaf-root AND
    // as a folder. Both stay visible; the folder has a chevron + folder
    // icon, the leaf has a target and is clickable. The renderer pattern
    // makes it visually clear that these are two different things.
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
    expect(leaf?.icon).toBe("file");
    expect(leaf?.target).toBeDefined();
    expect(folder?.label).toBe("page");
    expect(folder?.icon).toBe("folder");
    expect(folder?.target).toBeUndefined();
  });
  test("tenantIdOverride is passed to the Edit-Target-Args (SystemAdmin SYSTEM-Tenant-Content)", () => {
    const nodes = inside(
      groupBlocksByFolder(
        [block({ slug: "imprint", folder: null }), block({ slug: "hero", folder: "page" })],
        "00000000-0000-4000-8000-000000000000",
      ),
    );
    // Root-leaf carries the override.
    expect(nodes[0]?.target?.args).toEqual({
      slug: "imprint",
      locale: "de",
      tenantIdOverride: "00000000-0000-4000-8000-000000000000",
    });
    // The leaf inside the folder too (passed through recursively).
    const folderChild = childrenArray(nodes[1]?.children)[0];
    expect(folderChild?.target?.args).toEqual({
      slug: "hero",
      locale: "de",
      tenantIdOverride: "00000000-0000-4000-8000-000000000000",
    });
  });
  test("without tenantIdOverride, the Args remain free of it (Default: Session-Tenant)", () => {
    const nodes = inside(groupBlocksByFolder([block({ slug: "imprint", folder: null })]));
    expect(nodes[0]?.target?.args).toEqual({ slug: "imprint", locale: "de" });
  });
  test("Wrapper Folder 'Content' encloses all blocks", () => {
    // Wrapper convention: groupBlocksByFolder returns ONE node
    // (the wrapper), content sits one level deeper.
    const result = groupBlocksByFolder([block({ slug: "imprint" })]);
    expect(result).toHaveLength(1);
    const wrapper = result[0];
    expect(wrapper?.label).toBe("Content");
    expect(wrapper?.icon).toBe("folder");
    expect(wrapper?.target).toBeUndefined();
    expect(childrenArray(wrapper?.children)).toHaveLength(1);
  });
});
