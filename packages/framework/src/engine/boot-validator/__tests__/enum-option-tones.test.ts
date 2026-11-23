import { describe, expect, test } from "bun:test";
import { validateBooleanTones, validateEnumOptionTones } from "../screens-lists.ts";

describe("validateEnumOptionTones", () => {
  test("accepts known tones", () => {
    expect(() =>
      validateEnumOptionTones("p", {
        field: "status",
        renderer: { format: "enumOption", keyPrefix: "s.", tones: { ok: "ok", failed: "bad" } },
      }),
    ).not.toThrow();
  });

  test("rejects a typo'd tone", () => {
    expect(() =>
      validateEnumOptionTones("p", {
        field: "status",
        renderer: { format: "enumOption", keyPrefix: "s.", tones: { failed: "danger" } },
      }),
    ).toThrow(/column "status" has enumOption tones danger/);
  });
});

describe("validateBooleanTones", () => {
  const column = (renderer: object) => ({ field: "parked", renderer });

  test("accepts a tone with its label", () => {
    expect(() =>
      validateBooleanTones(
        "p",
        column({ format: "boolean", trueLabel: "Parked", trueTone: "warn", falseLabel: "Active" }),
      ),
    ).not.toThrow();
  });

  test("rejects a tone without its label", () => {
    expect(() =>
      validateBooleanTones("p", column({ format: "boolean", falseTone: "ok", trueLabel: "Yes" })),
    ).toThrow(/sets falseTone without falseLabel/);
  });

  test("rejects an unknown tone", () => {
    expect(() =>
      validateBooleanTones(
        "p",
        column({ format: "boolean", trueLabel: "Yes", trueTone: "danger" }),
      ),
    ).toThrow(/trueTone danger/);
  });
});
