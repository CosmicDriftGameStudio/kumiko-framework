// E2E generator sample — unit test.
//
// Purpose: shows a realistic generator run (shop feature with all
// supported + a few deliberately unsupported field types). The snapshot
// documents the result; any feature author touching the generator for the
// first time can look here instead of at the implementation.

import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { generateE2ESpec, withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { createShopFeature } from "../feature";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const shop = createShopFeature();
const registry = createRegistry([shop]);

describe("e2e-generator sample — shop feature", () => {
  test("validateBoot accepts the feature", () => {
    expect(() => validateBoot([shop])).not.toThrow();
  });

  test("generateE2ESpec returns all four kinds for the List+Edit pair", () => {
    const specs = generateE2ESpec(registry);
    const kinds = specs.map((s) => s.kind).sort();
    expect(kinds).toEqual([
      "edit-save-persists",
      "edit-validates-required",
      "list-has-fixture-row",
      "list-renders",
    ]);
  });

  test("list-has-fixture-row references the Create handler + uses name as the identifying field", () => {
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

  test("edit-validates-required lists only actual required fields (name, price)", () => {
    const specs = generateE2ESpec(registry);
    const validates = specs.find((s) => s.kind === "edit-validates-required");
    if (validates?.kind !== "edit-validates-required") throw new Error("unreachable");
    expect(validates.requiredFields).toEqual(["name", "price"]);
  });

  test("edit-save-persists maps field types to the correct Playwright interactions", () => {
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
    // money (listPrice) is deliberately skipped in the form — a complex
    // widget (amount + currency) that the generator cannot automate
    // generically. The API seed uses it anyway (see test above).
    expect(opsByField.has("listPrice")).toBe(false);
  });

  test("Output is JSON-serializable (process boundary to Playwright worker)", () => {
    // The sample feature must round-trip: TestSpec → JSON.stringify →
    // JSON.parse. In the production setup a bun subprocess (globalSetup) writes
    // the JSON to disk, the Playwright worker reads it — no runtime import
    // of the framework in the test process (would collide with Playwright's expect).
    const specs = generateE2ESpec(registry);
    const roundtripped = JSON.parse(JSON.stringify(specs));
    expect(roundtripped).toEqual(specs);
  });
});
