import { describe, expect, test } from "bun:test";
import type { FieldDefinition } from "../../engine/types/fields.ts";
import {
  fileRefIdsInField,
  holdsFileRefs,
  isFileSubField,
  mapFileRefSlots,
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

describe("mapFileRefSlots", () => {
  const upper = (entry: string) => entry.toUpperCase();

  test("maps a single file slot, a list and the file sub-fields of embedded rows", () => {
    expect(mapFileRefSlots({ type: "image" }, "a", upper)).toBe("A");
    expect(mapFileRefSlots({ type: "images" }, ["a", 1, "b"], upper)).toEqual(["A", 1, "B"]);
    expect(
      mapFileRefSlots(list, [{ label: "keep", photos: ["a"], docs: ["b"] }, "junk"], upper),
    ).toEqual([{ label: "keep", photos: ["A"], docs: ["B"] }, "junk"]);
    expect(mapFileRefSlots(single, { photos: ["a"] }, upper)).toEqual({ photos: ["A"] });
  });

  test("leaves fields without file slots untouched", () => {
    expect(mapFileRefSlots({ type: "text" }, "a", upper)).toBe("a");
    expect(mapFileRefSlots(undefined, "a", upper)).toBe("a");
  });
});

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
