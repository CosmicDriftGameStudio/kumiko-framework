import { describe, expect, test } from "bun:test";
import { createEmbeddedListField, createSelectField, createTextField } from "../factories";

describe("visibleWhen / requiredWhen pass through the field factories", () => {
  test("text, select and embedded list accept and keep the conditions", () => {
    const condition = { field: "kind", eq: "a" } as const;
    const text = createTextField({
      personal: false,
      reason: "type_test_fixture",
      visibleWhen: condition,
      requiredWhen: condition,
    });
    const select = createSelectField({ options: ["a", "b"], visibleWhen: condition });
    const list = createEmbeddedListField(
      { note: { type: "text", visibleWhen: condition, requiredWhen: condition } },
      { personal: false, reason: "type_test_fixture", visibleWhen: condition },
    );
    expect(text.visibleWhen).toEqual(condition);
    expect(text.requiredWhen).toEqual(condition);
    expect(select.visibleWhen).toEqual(condition);
    expect(list.visibleWhen).toEqual(condition);
  });
});
