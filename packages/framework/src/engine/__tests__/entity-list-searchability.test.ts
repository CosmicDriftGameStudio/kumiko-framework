import { describe, expect, test } from "bun:test";
import { entityHasSearchableField, hasSearchableTextField } from "../entity-list-searchability.ts";
import {
  createEntity,
  createLongTextField,
  createReferenceField,
  createTextField,
} from "../factories.ts";

const plainText = createTextField({ personal: false, reason: "test_fixture" });
const plainLongText = createLongTextField({ personal: false, reason: "test_fixture" });

describe("searchable field detection", () => {
  test("text and longText fields count only when searchable", () => {
    const none = createEntity({ name: "plain", fields: { a: plainText, b: plainLongText } });
    const searchableLongText = createEntity({
      name: "note",
      fields: { body: { ...plainLongText, searchable: true } },
    });
    expect(hasSearchableTextField(none)).toBe(false);
    expect(entityHasSearchableField(none)).toBe(false);
    expect(hasSearchableTextField(searchableLongText)).toBe(true);
    expect(entityHasSearchableField(searchableLongText)).toBe(true);
  });

  test("a searchable reference makes the list searchable but not the text check", () => {
    const owner = createReferenceField({
      entity: "owner",
      personal: false,
      reason: "test_fixture",
    });
    const withReference = createEntity({
      name: "task",
      fields: { title: plainText, owner: { ...owner, searchable: true } },
    });
    expect(hasSearchableTextField(withReference)).toBe(false);
    expect(entityHasSearchableField(withReference)).toBe(true);
  });
});
