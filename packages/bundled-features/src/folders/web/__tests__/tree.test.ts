import { describe, expect, test } from "bun:test";
import { buildFolderTree, type FolderRow, folderPath } from "../tree";

const f = (id: string, name: string, parentId: string | null = null): FolderRow => ({
  id,
  name,
  parentId,
  version: 1,
});

describe("buildFolderTree", () => {
  test("empty input → no roots", () => {
    expect(buildFolderTree([])).toEqual([]);
  });

  test("flat roots are sorted by name with depth 0", () => {
    const tree = buildFolderTree([f("2", "Beta"), f("1", "Alpha")]);
    expect(tree.map((n) => n.name)).toEqual(["Alpha", "Beta"]);
    expect(tree.every((n) => n.depth === 0 && n.children.length === 0)).toBe(true);
  });

  test("children nest under their parent with incremented depth", () => {
    const tree = buildFolderTree([
      f("root", "Root"),
      f("child", "Child", "root"),
      f("grandchild", "Grandchild", "child"),
    ]);
    expect(tree).toHaveLength(1);
    const root = tree[0]!;
    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.depth).toBe(1);
    expect(root.children[0]!.children[0]!.name).toBe("Grandchild");
    expect(root.children[0]!.children[0]!.depth).toBe(2);
  });

  test("a row whose parentId points at a deleted parent surfaces as a root", () => {
    const tree = buildFolderTree([f("orphan", "Orphan", "gone")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Orphan");
    expect(tree[0]!.depth).toBe(0);
  });
});

describe("folderPath", () => {
  const rows = [f("a", "Immobilie"), f("b", "Müller", "a"), f("c", "Kredit", "b")];

  test("root folder → just its name", () => {
    expect(folderPath(rows, "a")).toBe("Immobilie");
  });

  test("nested folder → full path", () => {
    expect(folderPath(rows, "c")).toBe("Immobilie / Müller / Kredit");
  });

  test("unknown id → empty string", () => {
    expect(folderPath(rows, "nope")).toBe("");
  });
});
