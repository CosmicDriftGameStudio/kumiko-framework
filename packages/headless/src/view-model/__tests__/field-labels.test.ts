import { describe, expect, test } from "bun:test";
import { buildOptionLabels, fieldLabelKey, fieldOptionLabelKey } from "../list";

describe("fieldLabelKey", () => {
  test("follows feature:entity:field convention", () => {
    expect(fieldLabelKey("billing", "invoice", "amount")).toBe(
      "billing:entity:invoice:field:amount",
    );
  });
});

describe("fieldOptionLabelKey", () => {
  test("appends option value segment", () => {
    expect(fieldOptionLabelKey("billing", "invoice", "status", "paid")).toBe(
      "billing:entity:invoice:field:status:option:paid",
    );
  });
});

describe("buildOptionLabels", () => {
  test("maps option values to translated labels with fallback to raw value", () => {
    const labels = buildOptionLabels(
      (key) => (key.endsWith(":option:draft") ? "Draft" : key),
      "tasks",
      "task",
      "status",
      ["draft", "done"],
    );
    expect(labels["draft"]).toBe("Draft");
    expect(labels["done"]).toBe("done");
  });
});
