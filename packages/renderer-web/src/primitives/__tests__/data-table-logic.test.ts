// DataTable-Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// Reine Funktionen aus primitives/index.tsx (exportiert für Test, wie
// money-input seine Pure-Logik exportiert). Kein DOM.

import { describe, expect, test } from "bun:test";
import {
  applyFormatSpec,
  computeVisiblePages,
  defaultCellRender,
  isComponentRendererRef,
} from "../index";

describe("computeVisiblePages", () => {
  test("<= 7 Seiten: alle Seiten, keine Ellipsis", () => {
    expect(computeVisiblePages(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(computeVisiblePages(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("erste + letzte Seite immer als Anker enthalten", () => {
    const pages = computeVisiblePages(10, 20);
    expect(pages[0]).toBe(1);
    expect(pages.at(-1)).toBe(20);
  });

  test("Mitte (p=10/20): page±2-Window mit Ellipsen beidseitig", () => {
    expect(computeVisiblePages(10, 20)).toEqual([1, "ellipsis", 8, 9, 10, 11, 12, "ellipsis", 20]);
  });

  test("Rand p=1/20: 5 Zahlen links sichtbar (Fenster verschoben, nicht abgeschnitten)", () => {
    expect(computeVisiblePages(1, 20)).toEqual([1, 2, 3, 4, 5, "ellipsis", 20]);
  });

  test("Rand p=20/20: 5 Zahlen rechts sichtbar", () => {
    expect(computeVisiblePages(20, 20)).toEqual([1, "ellipsis", 16, 17, 18, 19, 20]);
  });

  test("page=5/20: Übergang Rand→Mitte (Ellipsis links erscheint)", () => {
    expect(computeVisiblePages(5, 20)).toEqual([1, "ellipsis", 3, 4, 5, 6, 7, "ellipsis", 20]);
  });
});

describe("isComponentRendererRef", () => {
  test("erkennt { react: { __component: 'Name' } }", () => {
    expect(isComponentRendererRef({ react: { __component: "MyCell" } })).toEqual({
      name: "MyCell",
    });
  });

  test("null / non-object / fehlender react-Branch → undefined", () => {
    expect(isComponentRendererRef(null)).toBeUndefined();
    expect(isComponentRendererRef("x")).toBeUndefined();
    expect(isComponentRendererRef({})).toBeUndefined();
    expect(isComponentRendererRef({ react: null })).toBeUndefined();
  });

  test("leerer oder fehlender __component → undefined", () => {
    expect(isComponentRendererRef({ react: {} })).toBeUndefined();
    expect(isComponentRendererRef({ react: { __component: "" } })).toBeUndefined();
  });
});

describe("applyFormatSpec", () => {
  test("null/undefined/leer → leerer String (alle Formate)", () => {
    expect(applyFormatSpec({ format: "boolean" }, null)).toBe("");
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, undefined)).toBe("");
    expect(applyFormatSpec({ format: "priority" }, "")).toBe("");
  });

  test("boolean: true → ✓, false → leer (defaults)", () => {
    expect(applyFormatSpec({ format: "boolean" }, true)).toBe("✓");
    expect(applyFormatSpec({ format: "boolean" }, false)).toBe("");
  });

  test("boolean: benutzerdefinierte Labels", () => {
    expect(
      applyFormatSpec({ format: "boolean", trueLabel: "Public", falseLabel: "Hidden" }, true),
    ).toBe("Public");
    expect(
      applyFormatSpec({ format: "boolean", trueLabel: "Public", falseLabel: "Hidden" }, false),
    ).toBe("Hidden");
  });

  test("currency: value + Leerzeichen + symbol", () => {
    expect(applyFormatSpec({ format: "currency", symbol: "€" }, 42)).toBe("42 €");
    expect(applyFormatSpec({ format: "currency", symbol: "$" }, "99.90")).toBe("99.90 $");
  });

  test("currency: kein symbol → reiner Wert", () => {
    expect(applyFormatSpec({ format: "currency" }, 42)).toBe("42");
  });

  test("priority: 0 → Standard-Dash, Zahl → prefix+value", () => {
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 0)).toBe("—");
    expect(applyFormatSpec({ format: "priority", prefix: "P" }, 3)).toBe("P3");
  });

  test("priority: benutzerdefinierter emptyLabel + kein prefix", () => {
    expect(applyFormatSpec({ format: "priority", emptyLabel: "none" }, 0)).toBe("none");
    expect(applyFormatSpec({ format: "priority" }, 5)).toBe("5");
  });

  test("unbekanntes format → String(value) fallback", () => {
    expect(applyFormatSpec({ format: "custom-app-format" }, 42)).toBe("42");
    expect(applyFormatSpec({ format: "custom-app-format" }, "hello")).toBe("hello");
  });
});

describe("defaultCellRender", () => {
  test("null/undefined/leerer String → leerer String", () => {
    expect(defaultCellRender(null, "text")).toBe("");
    expect(defaultCellRender(undefined, "text")).toBe("");
    expect(defaultCellRender("", "text")).toBe("");
  });

  test("boolean → ✓ bei true, leer bei false", () => {
    expect(defaultCellRender(true, "boolean")).toBe("✓");
    expect(defaultCellRender(false, "boolean")).toBe("");
  });

  test("select → humanizeSlug (kebab → Title Case), wenn kein optionLabel", () => {
    expect(defaultCellRender("degraded-performance", "select")).toBe("Degraded performance");
  });

  test("select → registriertes optionLabel gewinnt vor humanizeSlug", () => {
    expect(defaultCellRender("op-x", "select", { "op-x": "Operativ X" })).toBe("Operativ X");
  });

  test("text/number → String-Repräsentation", () => {
    expect(defaultCellRender("hallo", "text")).toBe("hallo");
    expect(defaultCellRender(42, "number")).toBe("42");
  });
});
