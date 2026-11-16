import { describe, expect, test } from "bun:test";
import { buildFolderTree, type FolderRow, folderPath } from "../index.ts";

const rows: readonly FolderRow[] = [
  { id: "root", name: "Immobilie", parentId: null, version: 1 },
  { id: "berlin", name: "Haus Berlin", parentId: "root", version: 1 },
  { id: "solo", name: "Archiv", parentId: null, version: 1 },
];

describe("folder tree helpers on the server barrel", () => {
  test("folderPath from the server barrel labels a nested folder with its full path", () => {
    expect(folderPath(rows, "berlin")).toBe("Immobilie / Haus Berlin");
    expect(folderPath(rows, "unknown")).toBe("");
  });

  test("buildFolderTree from the server barrel nests children under their parent", () => {
    const tree = buildFolderTree(rows);
    expect(tree.map((n) => n.name)).toEqual(["Archiv", "Immobilie"]);
    const node = tree.find((n) => n.name === "Immobilie");
    expect(node?.children.map((n) => n.name)).toEqual(["Haus Berlin"]);
    expect(node?.children[0]?.depth).toBe(1);
  });
});
