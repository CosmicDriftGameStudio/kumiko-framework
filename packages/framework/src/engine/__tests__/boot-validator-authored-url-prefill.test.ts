import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture.js";
import { validateBoot as validateBootRaw } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import type { ScreenDefinition } from "../types/screen.js";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("validateBoot — urlPrefillFields is derived, never authored", () => {
  test("a form screen that sets urlPrefillFields → Throw naming the screen", () => {
    const feature = defineFeature("billing", (r) => {
      r.screen({
        id: "record-payment",
        type: "actionForm",
        handler: "billing:write:payment:record",
        fields: { iban: { type: "text" } },
        layout: { sections: [{ title: "x", fields: ["iban"] }] },
        urlPrefillFields: ["iban"],
        dormant: true,
      } as ScreenDefinition);
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "record-payment" \(actionForm\) sets urlPrefillFields/,
    );
  });
});
