import { describe, expect, test } from "bun:test";
import {
  buttonTargetLabel,
  repeatTableContent,
  variableLabelOf,
} from "../document-tiptap-helpers.ts";

describe("variableLabelOf", () => {
  test("returns the label of a known variable", () => {
    expect(variableLabelOf("customer.name", { "customer.name": "Customer" })).toBe("Customer");
  });

  test("falls back to the name and ignores inherited object keys", () => {
    expect(variableLabelOf("customer.name", {})).toBe("customer.name");
    expect(variableLabelOf("constructor", {})).toBe("constructor");
  });
});

describe("buttonTargetLabel", () => {
  test("shows the label of a placeholder href", () => {
    expect(buttonTargetLabel("{{invoice.url}}", { "invoice.url": "Invoice link" })).toBe(
      "Invoice link",
    );
  });

  test("shows the bare variable name when it has no label", () => {
    expect(buttonTargetLabel("{{invoice.url}}", {})).toBe("invoice.url");
  });

  test("keeps a plain href untouched", () => {
    expect(buttonTargetLabel("https://example.com", { "https://example.com": "x" })).toBe(
      "https://example.com",
    );
  });
});

describe("repeatTableContent", () => {
  test("builds a header row plus one row repeated over the list", () => {
    const table = repeatTableContent("items");
    const [header, repeat] = table.content ?? [];
    expect(table.type).toBe("table");
    expect(header?.attrs).toBeUndefined();
    expect(header?.content?.map((cell) => cell.type)).toEqual(["tableHeader", "tableHeader"]);
    expect(repeat?.attrs).toEqual({ each: "items" });
    expect(repeat?.content?.map((cell) => cell.type)).toEqual(["tableCell", "tableCell"]);
  });
});
