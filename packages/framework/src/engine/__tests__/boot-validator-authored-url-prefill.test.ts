import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import type { ScreenDefinition } from "../types/screen.ts";

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
