import { describe, expect, test } from "bun:test";
import { createLongTextField, createNumberField, createTextField } from "../factories";
import type { FieldsMap } from "../types";

// The compile-time half of the personal-stance requirement: this file only
// typechecks while the @ts-expect-error lines stay errors.
describe("FieldsMap requires a personal stance on text fields", () => {
  test("raw text and longText literals are rejected by the type", () => {
    // @ts-expect-error text field without a personal stance
    const rawText: FieldsMap = { name: { type: "text" } };
    // @ts-expect-error longText field without a personal stance
    const rawLongText: FieldsMap = { body: { type: "longText" } };
    expect(rawText).toBeDefined();
    expect(rawLongText).toBeDefined();
  });

  test("factory fields and non-text fields are accepted", () => {
    const fields: FieldsMap = {
      name: createTextField({ personal: false, reason: "type_test_fixture" }),
      body: createLongTextField({ personal: "self", find: "none" }),
      amount: createNumberField(),
    };
    expect(Object.keys(fields)).toEqual(["name", "body", "amount"]);
  });
});
