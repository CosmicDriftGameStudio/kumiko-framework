import { describe, expect, test } from "bun:test";
import type { FieldDefinition } from "../../engine/types/fields.ts";
import {
  fileRefIdsInField,
  holdsFileRefs,
  isFileSubField,
  resolveFileSubField,
} from "../file-field-slots.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const list: FieldDefinition = {
  type: "embedded",
  multiple: true,
  schema: {
    label: { type: "text" },
    photos: { type: "images", maxCount: 3 },
    docs: { type: "files" },
  },
};
const single: FieldDefinition = { type: "embedded", schema: { photos: { type: "images" } } };

describe("file-field-slots", () => {
  test("holdsFileRefs: file fields and embedded with file sub-fields", () => {
    expect(holdsFileRefs({ type: "images" })).toBe(true);
    expect(holdsFileRefs(list)).toBe(true);
    expect(holdsFileRefs({ type: "embedded", schema: { a: { type: "text" } } })).toBe(false);
    expect(holdsFileRefs({ type: "text" })).toBe(false);
    expect(holdsFileRefs(undefined)).toBe(false);
  });

  test("fileRefIdsInField: top-level, list rows and single object", () => {
    expect(fileRefIdsInField({ type: "images" }, [A, "nope"])).toEqual([A]);
    expect(fileRefIdsInField(list, [{ label: A, photos: [A] }, { docs: [B] }, "junk"])).toEqual([
      A,
      B,
    ]);
    expect(fileRefIdsInField(single, { photos: [B] })).toEqual([B]);
    expect(fileRefIdsInField(single, undefined)).toEqual([]);
  });

  test("resolveFileSubField only resolves file sub-fields", () => {
    expect(resolveFileSubField(list, "photos")?.type).toBe("images");
    expect(resolveFileSubField(list, "label")).toBeUndefined();
    expect(resolveFileSubField({ type: "images" }, "photos")).toBeUndefined();
    expect(isFileSubField({ type: "text" })).toBe(false);
  });
});
