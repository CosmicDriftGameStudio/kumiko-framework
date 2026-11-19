import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import type { ActionFormRedirect, ScreenDefinition } from "../types/screen.ts";

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

describe("validateBoot — redirect handOff", () => {
  const withRedirect = (redirect: ActionFormRedirect) =>
    defineFeature("billing", (r) => {
      for (const name of ["check", "confirm"]) {
        r.writeHandler({
          name,
          schema: z.object({ code: z.string() }),
          access: { openToAll: { reason: "test fixture" } },
          handler: async () => ({ isSuccess: true as const, data: {} }),
        });
      }
      r.screen({
        id: "step-two",
        type: "actionForm",
        handler: "billing:write:confirm",
        fields: { code: { type: "text" } },
        layout: { sections: [{ title: "x", fields: ["code"] }] },
        dormant: true,
      } as ScreenDefinition);
      r.screen({
        id: "step-one",
        type: "actionForm",
        handler: "billing:write:check",
        fields: { code: { type: "text" } },
        layout: { sections: [{ title: "x", fields: ["code"] }] },
        redirect,
        dormant: true,
      } as ScreenDefinition);
    });

  test("handOff without searchParams stops the boot", () => {
    expect(() => validateBoot([withRedirect({ screen: "step-two", handOff: true })])).toThrow(
      /handOff.*no searchParams/,
    );
  });

  test("handOff with searchParams boots", () => {
    expect(() =>
      validateBoot([
        withRedirect({ screen: "step-two", searchParams: { code: "code" }, handOff: true }),
      ]),
    ).not.toThrow();
  });
});
