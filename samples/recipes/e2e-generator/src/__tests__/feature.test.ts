// E2E-Generator Sample — Unit-Test.
//
// Zweck: zeigt einen realistischen Generator-Run (shop-Feature mit allen
// unterstützten + ein paar bewusst unsupported Feldtypen). Der Snapshot
// dokumentiert das Ergebnis; jeder Feature-Autor der den Generator zum
// ersten Mal anfasst kann hier reinschauen statt in die Implementation.

import { describe, expect, test } from "bun:test";
import { createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { generateE2ESpec } from "@cosmicdrift/kumiko-framework/testing";
import { createShopFeature } from "../feature";

const shop = createShopFeature();
const registry = createRegistry([shop]);

describe("e2e-generator sample — shop feature", () => {
  test("validateBoot akzeptiert das Feature", () => {
    expect(() => validateBoot([shop])).not.toThrow();
  });

  test("generateE2ESpec liefert alle vier Kinds für das List+Edit-Paar", () => {
    const specs = generateE2ESpec(registry);
    const kinds = specs.map((s) => s.kind).sort();
    expect(kinds).toEqual([
      "edit-save-persists",
      "edit-validates-required",
      "list-has-fixture-row",
      "list-renders",
    ]);
  });

  test("list-has-fixture-row referenziert den Create-Handler + nutzt name als Identifying", () => {
    const specs = generateE2ESpec(registry);
    const row = specs.find((s) => s.kind === "list-has-fixture-row");
    if (row?.kind !== "list-has-fixture-row") throw new Error("unreachable");

    expect(row.writeHandlerQn).toBe("shop:write:product:create");
    expect(row.urlPath).toBe("/t/{tenant}/shop/product-list");
    // name ist die erste Text-Column → Identifying-Value
    expect(row.identifyingValue).toBe("e2e name");
    // money hat eine generische Object-Fixture → landet im API-Seed (die API
    // erwartet { amount, currency }), aber NICHT im Edit-Form (siehe
    // edit-save-persists-Test unten — kein Form-Widget generisch).
    expect(row.fixture["listPrice"]).toEqual({ amount: 1, currency: "EUR" });
  });

  test("edit-validates-required listet nur echte required-Felder (name, price)", () => {
    const specs = generateE2ESpec(registry);
    const validates = specs.find((s) => s.kind === "edit-validates-required");
    if (validates?.kind !== "edit-validates-required") throw new Error("unreachable");
    expect(validates.requiredFields).toEqual(["name", "price"]);
  });

  test("edit-save-persists mapped Feldtypen auf die richtigen Playwright-Interaktionen", () => {
    const specs = generateE2ESpec(registry);
    const save = specs.find((s) => s.kind === "edit-save-persists");
    if (save?.kind !== "edit-save-persists") throw new Error("unreachable");

    const opsByField = new Map(save.fills.map((op) => [op.field, op.kind]));
    expect(opsByField.get("name")).toBe("fill");
    expect(opsByField.get("description")).toBe("fill");
    expect(opsByField.get("price")).toBe("fill");
    // DER eigentliche Regression-Guard: select darf NICHT auf .fill() landen,
    // sonst zerschellt Playwright am ersten Dropdown.
    expect(opsByField.get("status")).toBe("select");
    expect(opsByField.get("featured")).toBe("check");
    // money (listPrice) wird im Form bewusst übersprungen — komplexes
    // Widget (Betrag + Währung), das der Generator nicht generisch
    // automatisieren kann. API-Seed nutzt es trotzdem (siehe Test oben).
    expect(opsByField.has("listPrice")).toBe(false);
  });

  test("Output ist JSON-serialisierbar (Prozess-Grenze zu Playwright-Worker)", () => {
    // Das Sample-Feature muss sich rundtrippen lassen: TestSpec → JSON.stringify →
    // JSON.parse. Im produktiven Setup schreibt ein bun-Subprozess (globalSetup)
    // die JSON auf Platte, der Playwright-Worker liest sie — kein runtime-Import
    // vom Framework im Test-Prozess (würde mit Playwrights expect kollidieren).
    const specs = generateE2ESpec(registry);
    const roundtripped = JSON.parse(JSON.stringify(specs));
    expect(roundtripped).toEqual(specs);
  });
});
