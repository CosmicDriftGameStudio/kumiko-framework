import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { fieldCellWidth } from "../grid-cell-for-field.js";

function field(type: string): EditFieldViewModel {
  return {
    field: "f",
    label: "F",
    type,
    value: undefined,
    visible: true,
    readOnly: false,
    required: false,
  };
}

describe("fieldCellWidth", () => {
  test("boolean fields get the toggle width", () => {
    expect(fieldCellWidth(field("boolean"))).toBe("toggle");
  });

  test("number and select keep their own widths", () => {
    expect(fieldCellWidth(field("number"))).toBe("number");
    expect(fieldCellWidth(field("select"))).toBe("select");
  });
});
