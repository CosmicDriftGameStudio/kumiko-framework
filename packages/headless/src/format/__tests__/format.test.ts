import { describe, expect, test } from "bun:test";
import { applyFormatSpec } from "../index";

describe("applyFormatSpec — priority", () => {
  test("rendert emptyLabel für undefined/null/leer/0 (nicht den globalen ''-Collapse)", () => {
    expect(applyFormatSpec({ format: "priority" }, undefined)).toBe("—");
    expect(applyFormatSpec({ format: "priority" }, null)).toBe("—");
    expect(applyFormatSpec({ format: "priority" }, "")).toBe("—");
    expect(applyFormatSpec({ format: "priority" }, 0)).toBe("—");
  });

  test("custom emptyLabel + prefix", () => {
    expect(applyFormatSpec({ format: "priority", emptyLabel: "none" }, null)).toBe("none");
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 2)).toBe("P2");
  });
});

describe("applyFormatSpec — leere Werte anderer Formate", () => {
  test("collapsen zu ''", () => {
    expect(applyFormatSpec({ format: "boolean" }, undefined)).toBe("");
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, null)).toBe("");
    expect(applyFormatSpec({ format: "timestamp" }, "")).toBe("");
  });
});

describe("applyFormatSpec — boolean/currency", () => {
  test("boolean mit Default- und Custom-Labels", () => {
    expect(applyFormatSpec({ format: "boolean" }, true)).toBe("✓");
    expect(applyFormatSpec({ format: "boolean" }, false)).toBe("");
    expect(applyFormatSpec({ format: "boolean", trueLabel: "ja", falseLabel: "nein" }, false)).toBe(
      "nein",
    );
  });

  test("currency hängt Symbol an", () => {
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, 12)).toBe("12 €");
    expect(applyFormatSpec({ format: "currency" }, 12)).toBe("12");
  });
});
