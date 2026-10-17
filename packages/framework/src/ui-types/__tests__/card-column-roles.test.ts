import { describe, expect, test } from "bun:test";
import { cardColumnRoles, cardFileDisplayKind } from "../card-column-roles.js";

describe("cardColumnRoles", () => {
  test("the first column is the title when none is highlighted", () => {
    const columns = [{ field: "a" }, { field: "b" }, { field: "c" }];
    const roles = cardColumnRoles(columns);
    expect(roles.title?.field).toBe("a");
    expect(roles.meta.map((c) => c.field)).toEqual(["b", "c"]);
  });

  test("a highlighted column wins the title over the first one", () => {
    const roles = cardColumnRoles([{ field: "a" }, { field: "b", highlighted: true }]);
    expect(roles.title?.field).toBe("b");
    expect(roles.meta.map((c) => c.field)).toEqual(["a"]);
  });

  test("the first select without renderer is the status, later selects stay meta", () => {
    const roles = cardColumnRoles([
      { field: "name" },
      { field: "s1", type: "select" },
      { field: "s2", type: "select" },
    ]);
    expect(roles.status?.field).toBe("s1");
    expect(roles.meta.map((c) => c.field)).toEqual(["s2"]);
  });

  test("a select with a renderer is not a status; a title select is not a status either", () => {
    const withRenderer = cardColumnRoles([
      { field: "name" },
      { field: "s", type: "select", renderer: { format: "x" } },
    ]);
    expect(withRenderer.status).toBeUndefined();
    expect(withRenderer.meta.map((c) => c.field)).toEqual(["s"]);

    const titleSelect = cardColumnRoles([{ field: "s", type: "select" }, { field: "n" }]);
    expect(titleSelect.status).toBeUndefined();
  });

  test("hideOnNarrow columns are left out of meta; empty input has no roles", () => {
    const roles = cardColumnRoles([{ field: "a" }, { field: "b", hideOnNarrow: true }]);
    expect(roles.meta).toEqual([]);
    expect(cardColumnRoles([])).toEqual({
      image: undefined,
      title: undefined,
      status: undefined,
      meta: [],
    });
  });

  test("the first image column is neither title nor meta; later ones stay meta", () => {
    const roles = cardColumnRoles([
      { field: "photo", fileDisplay: { kind: "image" } },
      { field: "name" },
      { field: "logo", fileDisplay: { kind: "image" } },
      { field: "doc", fileDisplay: { kind: "file" } },
    ]);
    expect(roles.image?.field).toBe("photo");
    expect(roles.title?.field).toBe("name");
    expect(roles.meta.map((c) => c.field)).toEqual(["logo", "doc"]);
  });

  test("an image column hidden on narrow is not the preview and not the title", () => {
    const roles = cardColumnRoles([
      { field: "banner", fileDisplay: { kind: "image" }, hideOnNarrow: true },
      { field: "photo", fileDisplay: { kind: "image" } },
      { field: "name" },
    ]);
    expect(roles.image?.field).toBe("photo");
    expect(roles.title?.field).toBe("name");
    expect(roles.meta).toEqual([]);

    const onlyHidden = cardColumnRoles([
      { field: "banner", fileDisplay: { kind: "image" }, hideOnNarrow: true },
      { field: "name" },
    ]);
    expect(onlyHidden.image).toBeUndefined();
    expect(onlyHidden.title?.field).toBe("name");
  });

  test("cardFileDisplayKind: a format renderer wins over the field type", () => {
    expect(cardFileDisplayKind("image", undefined)).toBe("image");
    expect(cardFileDisplayKind("files", undefined)).toBe("file");
    expect(cardFileDisplayKind("text", { format: "image" })).toBe("image");
    expect(cardFileDisplayKind("image", { format: "file" })).toBe("file");
    expect(cardFileDisplayKind("text", undefined)).toBeUndefined();
  });
});
