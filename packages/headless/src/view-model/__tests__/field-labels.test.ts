import { describe, expect, test } from "bun:test";
import {
  buildOptionLabels,
  embeddedCellLabelKey,
  embeddedCellOptionLabelKey,
  fieldLabelKey,
  fieldOptionLabelKey,
} from "../list";

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

describe("embeddedCellLabelKey", () => {
  test("adds a cell segment for the sub-field name", () => {
    expect(embeddedCellLabelKey("billing", "invoice", "lines", "quantity")).toBe(
      "billing:entity:invoice:field:lines:cell:quantity",
    );
  });
});

describe("embeddedCellOptionLabelKey", () => {
  test("appends option value segment after the cell segment", () => {
    expect(embeddedCellOptionLabelKey("billing", "invoice", "lines", "unit", "hour")).toBe(
      "billing:entity:invoice:field:lines:cell:unit:option:hour",
    );
  });
});

describe("buildOptionLabels", () => {
  test("maps option values to translated labels with fallback to raw value", () => {
    const labels = buildOptionLabels(
      (key) => (key.endsWith(":option:draft") ? "Draft" : key),
      (value) => fieldOptionLabelKey("tasks", "task", "status", value),
      ["draft", "done"],
    );
    expect(labels["draft"]).toBe("Draft");
    expect(labels["done"]).toBe("done");
  });

  test("keyFor lets the caller supply any key convention (e.g. embedded cell)", () => {
    const labels = buildOptionLabels(
      (key) => (key.endsWith(":option:hour") ? "Hour" : key),
      (value) => embeddedCellOptionLabelKey("billing", "invoice", "lines", "unit", value),
      ["hour", "day"],
    );
    expect(labels["hour"]).toBe("Hour");
    expect(labels["day"]).toBe("day");
  });
});
