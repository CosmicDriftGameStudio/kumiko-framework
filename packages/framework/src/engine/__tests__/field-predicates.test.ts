import { describe, expect, test } from "vitest";
import type { AnyFileFieldDef, FieldDefinition } from "../types";
import { isFileField } from "../types";

describe("isFileField()", () => {
  test("accepts all four file variants", () => {
    const variants: FieldDefinition[] = [
      { type: "file" },
      { type: "image" },
      { type: "files" },
      { type: "images" },
    ];
    for (const f of variants) expect(isFileField(f)).toBe(true);
  });

  test("rejects non-file variants", () => {
    const variants: FieldDefinition[] = [
      { type: "text" },
      { type: "number" },
      { type: "boolean" },
      { type: "select", options: ["a", "b"] },
      { type: "money" },
      { type: "date" },
      { type: "embedded", schema: {} },
    ];
    for (const f of variants) expect(isFileField(f)).toBe(false);
  });

  test("rejects undefined", () => {
    expect(isFileField(undefined)).toBe(false);
  });

  test("narrows the type so readers can access file-specific props", () => {
    const field: FieldDefinition | undefined = {
      type: "file",
      maxSize: "5mb",
      accept: ["image/*"],
    };
    if (isFileField(field)) {
      // If the TypeGuard didn't narrow, this would not compile.
      const narrowed: AnyFileFieldDef = field;
      expect(narrowed.maxSize).toBe("5mb");
      expect(narrowed.accept).toEqual(["image/*"]);
    } else {
      throw new Error("isFileField should have narrowed to AnyFileFieldDef");
    }
  });
});
