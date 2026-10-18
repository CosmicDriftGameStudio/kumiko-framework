import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
  FieldDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { computeListViewModel } from "../list.ts";
import { deriveListFileDisplay } from "../list-file-display.ts";

function fieldOf(definition: object): FieldDefinition {
  return definition as unknown as FieldDefinition;
}

describe("deriveListFileDisplay", () => {
  test("an image field uses its first declared variant", () => {
    expect(
      deriveListFileDisplay(
        fieldOf({ type: "image", variants: { thumb: {}, large: {} } }),
        undefined,
      ),
    ).toEqual({ kind: "image", variant: "thumb" });
  });

  test("images without variants request the original", () => {
    expect(deriveListFileDisplay(fieldOf({ type: "images" }), undefined)).toEqual({
      kind: "image",
    });
  });

  test("file and files fields show file names", () => {
    expect(deriveListFileDisplay(fieldOf({ type: "file" }), undefined)).toEqual({ kind: "file" });
    expect(deriveListFileDisplay(fieldOf({ type: "files" }), undefined)).toEqual({ kind: "file" });
  });

  test("a text field is untouched", () => {
    expect(deriveListFileDisplay(fieldOf({ type: "text" }), undefined)).toBeUndefined();
  });

  test("a FormatSpec renderer drives query-backed text columns", () => {
    const text = fieldOf({ type: "text" });
    expect(deriveListFileDisplay(text, { format: "image", variant: "card" })).toEqual({
      kind: "image",
      variant: "card",
    });
    expect(deriveListFileDisplay(text, { format: "image" })).toEqual({ kind: "image" });
    expect(deriveListFileDisplay(text, { format: "file" })).toEqual({ kind: "file" });
  });

  test("an unrelated FormatSpec does not set a file display", () => {
    expect(deriveListFileDisplay(fieldOf({ type: "text" }), { format: "json" })).toBeUndefined();
  });
});

describe("computeListViewModel — fileDisplay", () => {
  test("columns carry fileDisplay derived from the entity field type", () => {
    const entity = {
      fields: {
        name: { type: "text" },
        photo: { type: "image", variants: { thumb: {} } },
      },
    } as unknown as EntityDefinition;
    const screen: EntityListScreenDefinition = {
      id: "unit-list",
      type: "entityList",
      entity: "unit",
      columns: ["name", "photo"],
    };
    const vm = computeListViewModel({
      screen,
      entity,
      rows: [],
      translate: (k) => k,
      featureName: "rental",
    });
    expect(vm.columns.map((c) => c.fileDisplay)).toEqual([
      undefined,
      { kind: "image", variant: "thumb" },
    ]);
  });
});
