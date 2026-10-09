import { describe, expect, test } from "bun:test";
import type {
  EntityEditScreenDefinition,
  SecretMintScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { hiddenRequiredFieldsFilled } from "../layout-fields.js";

const fields: SecretMintScreenDefinition["fields"] = {
  id: { type: "text", required: true } as TextFieldDef,
  tags: { type: "text", required: true } as TextFieldDef,
  note: { type: "text" } as TextFieldDef,
};

function screenWith(layoutFields: readonly unknown[]): EntityEditScreenDefinition {
  return {
    id: "s",
    type: "entityEdit",
    entity: "e",
    layout: { sections: [{ fields: layoutFields }] },
  } as unknown as EntityEditScreenDefinition;
}

describe("hiddenRequiredFieldsFilled", () => {
  const hiddenId = screenWith([{ field: "id", visible: false }, "note"]);

  test("true when every hidden required field holds a value", () => {
    expect(hiddenRequiredFieldsFilled(hiddenId, fields, { id: "abc" })).toBe(true);
  });

  test.each([
    ["undefined", {}],
    ["null", { id: null }],
    ["empty string", { id: "" }],
    ["empty array", { id: [] }],
  ])("false when the hidden required field is %s", (_label, initial) => {
    expect(hiddenRequiredFieldsFilled(hiddenId, fields, initial)).toBe(false);
  });

  test("hidden optional and visible required fields do not count", () => {
    const screen = screenWith([{ field: "note", visible: false }, "id"]);
    expect(hiddenRequiredFieldsFilled(screen, fields, {})).toBe(true);
  });

  test("every hidden required field must be filled", () => {
    const screen = screenWith([
      { field: "id", visible: false },
      { field: "tags", visible: false },
    ]);
    expect(hiddenRequiredFieldsFilled(screen, fields, { id: "a" })).toBe(false);
    expect(hiddenRequiredFieldsFilled(screen, fields, { id: "a", tags: "b" })).toBe(true);
  });
});
