import { describe, expect, test } from "bun:test";
import { validateEnumOptionTones } from "../screens-lists.ts";

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
