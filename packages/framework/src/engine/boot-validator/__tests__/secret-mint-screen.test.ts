import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// Mint-form → one-time reveal → confirm. Shares its six inline-form checks
// with actionForm (validateInlineFormScreen), plus its own reveal.fields
// checks: non-empty, unique `field`, non-empty `label`.
describe("secretMint screen", () => {
  type SecretMintOverride = {
    readonly handler?: string | undefined;
    readonly fields?: Record<string, unknown>;
    readonly sections?: ReadonlyArray<{
      readonly title: string;
      readonly fields: readonly string[];
    }>;
    readonly reveal?: {
      readonly fields: ReadonlyArray<{
        readonly field: string;
        readonly label: string;
        readonly display?: "code" | "list";
      }>;
    };
    readonly redirect?: string;
    readonly extraScreens?: readonly string[];
    readonly confirm?: {
      readonly handler?: string;
      readonly fields?: Record<string, unknown>;
      readonly sections?: ReadonlyArray<{
        readonly title: string;
        readonly fields: readonly string[];
      }>;
      readonly carry?: readonly string[];
      readonly mode?: "single" | "wizard" | "tabs";
      readonly draft?: boolean;
    };
  };

  function makeFeature(override: SecretMintOverride = {}) {
    const handler = override.handler ?? "shop:write:token:mint";
    const fields = override.fields ?? { label: { type: "text" } };
    const sections = override.sections ?? [{ title: "Mint", fields: ["label"] }];
    const reveal = override.reveal ?? {
      fields: [{ field: "token", label: "shop:screen:mint-token.field:token" }],
    };
    const confirmOverride = override.confirm;
    return defineFeature("shop", (r) => {
      r.writeHandler({
        name: "token:mint",
        schema: { _type: "stub" } as never,
        handler: async () => ({ isSuccess: true, data: {} }) as never,
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      if (confirmOverride !== undefined) {
        r.writeHandler({
          name: "token:confirm",
          schema: { _type: "stub" } as never,
          handler: async () => ({ isSuccess: true, data: {} }) as never,
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
      }
      r.screen({
        id: "mint-token",
        type: "secretMint",
        handler,
        fields: fields as never,
        layout: { sections: sections as never },
        reveal: reveal as never,
        ...(override.redirect !== undefined && { redirect: override.redirect }),
        ...(confirmOverride !== undefined && {
          confirm: {
            handler: confirmOverride.handler ?? "shop:write:token:confirm",
            fields: (confirmOverride.fields ?? { code: { type: "text" } }) as never,
            layout: {
              sections: (confirmOverride.sections ?? [
                { title: "Confirm", fields: ["code"] },
              ]) as never,
              ...(confirmOverride.mode !== undefined && { mode: confirmOverride.mode }),
              ...(confirmOverride.draft !== undefined && { draft: confirmOverride.draft }),
            },
            ...(confirmOverride.carry !== undefined && { carry: confirmOverride.carry }),
          },
        }),
      });
      for (const extra of override.extraScreens ?? []) {
        r.screen({
          id: extra,
          type: "custom",
          renderer: { react: "stub" },
        });
      }
    });
  }

  test("happy path: handler + fields + layout + reveal consistent → no throw", () => {
    expect(() => validateBoot([makeFeature()])).not.toThrow();
  });

  test("handler not registered as a write-handler → throws", () => {
    expect(() => validateBoot([makeFeature({ handler: "shop:query:token:list" })])).toThrow(
      /\(secretMint\) handler "shop:query:token:list" is not a registered write-handler/,
    );
  });

  // secretMint allows an empty fields map (input-less mint) — but
  // the default `sections` still references "label", which no longer
  // exists once `fields` is empty, so this still throws (just via the
  // layout check instead of the fields-map check).
  test("fields empty-Map without also clearing sections → Throw", () => {
    expect(() => validateBoot([makeFeature({ fields: {} })])).toThrow(
      /\(secretMint\) layout references unknown field "label"/,
    );
  });

  test("layout referenziert unknown field → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ sections: [{ title: "x", fields: ["ghost"] }] })]),
    ).toThrow(/\(secretMint\) layout references unknown field "ghost"/);
  });

  test("redirect → existing screen-id → no throw", () => {
    expect(() =>
      validateBoot([makeFeature({ redirect: "after-mint", extraScreens: ["after-mint"] })]),
    ).not.toThrow();
  });

  test("redirect → unknown screen-id → Throw", () => {
    expect(() => validateBoot([makeFeature({ redirect: "ghost-screen" })])).toThrow(
      /\(secretMint\) redirect "ghost-screen" does not resolve to a registered screen/,
    );
  });

  test("empty reveal.fields → Throw", () => {
    expect(() => validateBoot([makeFeature({ reveal: { fields: [] } })])).toThrow(
      /has an empty reveal\.fields list/,
    );
  });

  test("reveal.fields entry with an empty field → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({ reveal: { fields: [{ field: "", label: "shop:reveal:token" }] } }),
      ]),
    ).toThrow(/has a reveal\.fields entry with an empty or non-string "field"/);
  });

  test("reveal.fields with a duplicate field → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          reveal: {
            fields: [
              { field: "token", label: "a" },
              { field: "token", label: "b" },
            ],
          },
        }),
      ]),
    ).toThrow(/reveal\.fields has a duplicate field "token"/);
  });

  test("reveal.fields entry with an empty label → throws", () => {
    expect(() =>
      validateBoot([makeFeature({ reveal: { fields: [{ field: "token", label: "" }] } })]),
    ).toThrow(/reveal\.fields entry "token" has an empty or non-string "label"/);
  });

  // --- input-less mint: fields: {} + layout.sections: [] is the
  // only valid empty shape — the secret is server-generated, the mint step
  // is just its submit button.
  test("empty fields + empty sections (input-less mint) → no throw", () => {
    expect(() => validateBoot([makeFeature({ fields: {}, sections: [] })])).not.toThrow();
  });

  test("empty fields but non-empty sections list → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ fields: {}, sections: [{ title: "x", fields: ["ghost"] }] })]),
    ).toThrow(/\(secretMint\) layout references unknown field "ghost"/);
  });

  test("non-empty fields but empty sections list → Throw", () => {
    expect(() => validateBoot([makeFeature({ sections: [] })])).toThrow(
      /\(secretMint\) has an empty sections list/,
    );
  });

  // --- confirm step ---
  describe("confirm step", () => {
    test("happy path: confirm handler + fields + layout consistent → no throw", () => {
      expect(() => validateBoot([makeFeature({ confirm: {} })])).not.toThrow();
    });

    test("confirm.handler not a registered write-handler → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ confirm: { handler: "shop:query:token:list" } })]),
      ).toThrow(
        /\(secretMint confirm\) handler "shop:query:token:list" is not a registered write-handler/,
      );
    });

    test("confirm.fields empty map → Throw", () => {
      expect(() => validateBoot([makeFeature({ confirm: { fields: {} } })])).toThrow(
        /\(secretMint confirm\) has empty fields map/,
      );
    });

    test("confirm layout references unknown field → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ confirm: { sections: [{ title: "x", fields: ["ghost"] }] } })]),
      ).toThrow(/\(secretMint confirm\) layout references unknown field "ghost"/);
    });

    test("confirm layout mode 'wizard' → Throw", () => {
      expect(() => validateBoot([makeFeature({ confirm: { mode: "wizard" } })])).toThrow(
        /\(secretMint confirm\) sets layout\.mode: "wizard"/,
      );
    });

    test("confirm layout draft true → Throw", () => {
      expect(() => validateBoot([makeFeature({ confirm: { draft: true } })])).toThrow(
        /\(secretMint confirm\) sets layout\.draft: true/,
      );
    });

    test("carry entry colliding with a confirm.fields name → Throw", () => {
      expect(() => validateBoot([makeFeature({ confirm: { carry: ["code"] } })])).toThrow(
        /\(secretMint confirm\) carry field "code" also names a confirm\.fields entry/,
      );
    });

    test("carry entry that is not a confirm.fields name → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ confirm: { carry: ["setupToken"] } })]),
      ).not.toThrow();
    });
  });
});
