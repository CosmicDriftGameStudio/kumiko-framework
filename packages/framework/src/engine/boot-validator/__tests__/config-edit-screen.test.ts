import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { createTenantConfig } from "../../config-helpers.ts";
import { defineFeature } from "../../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// Form for the bundled config feature. The boot validator checks:
//   1) fields are non-empty and each has a type discriminator
//   2) the layout is consistent (non-empty sections and existing field references)
//   3) every field has an entry in `configKeys`
//   4) every qualified config key in `configKeys` is registered through `r.config(...)`
describe("configEdit screen", () => {
  type ConfigEditOverride = {
    readonly fields?: Record<string, unknown>;
    readonly sections?: ReadonlyArray<{
      readonly title: string;
      readonly fields: readonly string[];
    }>;
    readonly configKeys?: Readonly<Record<string, string>>;
    readonly mode?: "single" | "wizard";
    readonly draft?: boolean;
  };

  function makeFeature(override: ConfigEditOverride = {}) {
    const fields = override.fields ?? {
      siteName: { type: "text" },
      maxUploadMb: { type: "number" },
    };
    const sections = override.sections ?? [
      { title: "Basics", fields: ["siteName", "maxUploadMb"] },
    ];
    const configKeys = override.configKeys ?? {
      siteName: "shop:config:site-name",
      maxUploadMb: "shop:config:max-upload-mb",
    };
    return defineFeature("shop", (r) => {
      r.config({
        keys: {
          "site-name": createTenantConfig("text", { default: "" }),
          "max-upload-mb": createTenantConfig("number", { default: 10 }),
        },
      });
      r.screen({
        id: "settings",
        type: "configEdit",
        scope: "tenant",
        configKeys,
        fields: fields as never,
        layout: {
          sections: sections as never,
          ...(override.mode !== undefined ? { mode: override.mode } : {}),
          ...(override.draft !== undefined ? { draft: override.draft } : {}),
        },
      });
    });
  }

  test("unknown screen type → custom message instead of entity error", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({ id: "mystery", type: "bogus" } as never);
    });
    expect(() => validateBoot([feature])).toThrow(/Screen "mystery" has unknown type "bogus"\./);
  });

  test("unknown screen type is reported as such even when the app has nav entries", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({ id: "home", type: "custom", renderer: { react: "stub" } });
      r.nav({ id: "home", label: "Home", screen: "shop:screen:home" });
      r.screen({ id: "mystery", type: "bogus" } as never);
    });
    let message = "";
    try {
      validateBoot([feature]);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/Screen "mystery" has unknown type "bogus"\./);
    expect(message).not.toMatch(/Screen "mystery" has no nav entry/);
  });

  test("happy path: all 4 checks passed → no throw", () => {
    expect(() => validateBoot([makeFeature()])).not.toThrow();
  });

  test("fields empty-Map → Throw", () => {
    expect(() => validateBoot([makeFeature({ fields: {} })])).toThrow(
      /has empty fields map — declare at least one field/,
    );
  });

  test("field without a type discriminator → throws", () => {
    expect(() => validateBoot([makeFeature({ fields: { siteName: { required: true } } })])).toThrow(
      /field "siteName" has no `type` set/,
    );
  });

  test("empty layout.sections → Throw", () => {
    expect(() => validateBoot([makeFeature({ sections: [] })])).toThrow(
      /has an empty sections list/,
    );
  });

  test("layout referenziert unknown field → Throw", () => {
    expect(() =>
      validateBoot([makeFeature({ sections: [{ title: "x", fields: ["ghost"] }] })]),
    ).toThrow(/layout references unknown field "ghost"/);
  });

  test("field without a configKeys entry → throws with a hint about the mapping", () => {
    // `siteName` is present in the fields map but has no `configKeys` mapping.
    // Boot must fail because no value could be loaded at runtime.
    expect(() =>
      validateBoot([
        makeFeature({
          configKeys: { maxUploadMb: "shop:config:max-upload-mb" },
        }),
      ]),
    ).toThrow(/field "siteName" has no entry in the configKeys map/);
  });

  test("configKeys referenziert unbekannten qualifizierten Key → Throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          configKeys: {
            siteName: "shop:config:typo-here",
            maxUploadMb: "shop:config:max-upload-mb",
          },
        }),
      ]),
    ).toThrow(/Config key "shop:config:typo-here" is not declared in any feature registry/);
  });

  test("camelCase source (multi-word) → canonical kebab-case QN matches, no throw", () => {
    // Regression: `r.config` registers the camelCase object key
    // (`brandingTitle`), while the canonical QN is `shop:config:branding-title`
    // (defineFeature kebab-cases both). A configEdit screen referencing the
    // canonical kebab-case QN must not fail as unknown; without
    // qualifyEntityName the validator compared against the raw camelCase QN.
    const feature = defineFeature("shop", (r) => {
      r.config({ keys: { brandingTitle: createTenantConfig("text", { default: "" }) } });
      r.screen({
        id: "settings",
        type: "configEdit",
        scope: "tenant",
        configKeys: { title: "shop:config:branding-title" },
        fields: { title: { type: "text" } } as never,
        layout: { sections: [{ title: "Basics", fields: ["title"] }] } as never,
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("extension section without a component → throws (parity with entityEdit)", () => {
    // `synthesizeConfigEditScreen` passes the layout unchanged to RenderEdit;
    // without a react/native marker, an extension section would render empty
    // without an obvious error.
    const section = { kind: "extension", title: "Custom", component: {} };
    expect(() => validateBoot([makeFeature({ sections: [section] as never })])).toThrow(
      /\(configEdit\) extension section "Custom" has no component/,
    );
  });

  test("extension section with a react component → no throw", () => {
    const section = { kind: "extension", title: "Custom", component: { react: "Panel" } };
    expect(() => validateBoot([makeFeature({ sections: [section] as never })])).not.toThrow();
  });
  test("secretKeys references a field outside fields → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.config({ keys: { "site-name": createTenantConfig("text", { default: "" }) } });
      r.screen({
        id: "settings",
        type: "configEdit",
        scope: "tenant",
        configKeys: { siteName: "shop:config:site-name" },
        secretKeys: { smtpPassword: "shop:config:site-name" },
        fields: { siteName: { type: "text" } } as never,
        layout: { sections: [{ title: "Basics", fields: ["siteName"] }] } as never,
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /\(configEdit\) secretKeys names unknown field "smtpPassword"\./,
    );
  });

  function secretScreenFeature(scope: "tenant" | "system" | "user") {
    return defineFeature("shop", (r) => {
      r.secret({ name: "smtp-password", label: { en: "SMTP password" }, scope: "tenant" });
      r.screen({
        id: "settings",
        type: "configEdit",
        scope,
        configKeys: {},
        secretKeys: { smtpPassword: "shop:secret:smtp-password" },
        fields: { smtpPassword: { type: "text", writeOnly: true } } as never,
        layout: { sections: [{ title: "Mail", fields: ["smtpPassword"] }] } as never,
      });
    });
  }

  test("secretKeys on a tenant or system scope screen → no throw", () => {
    expect(() => validateBoot([secretScreenFeature("tenant")])).not.toThrow();
    expect(() => validateBoot([secretScreenFeature("system")])).not.toThrow();
  });

  test("secretKeys on a user scope screen → throws", () => {
    expect(() => validateBoot([secretScreenFeature("user")])).toThrow(
      /maps secret "shop:secret:smtp-password" on a user-scope screen/,
    );
  });

  describe("actions", () => {
    function actionFeature(actions: readonly Record<string, unknown>[], registerHandler = true) {
      return defineFeature("shop", (r) => {
        r.config({ keys: { "site-name": createTenantConfig("text", { default: "" }) } });
        if (registerHandler) {
          r.writeHandler({
            name: "probe",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }
        r.screen({
          id: "settings",
          type: "configEdit",
          scope: "tenant",
          configKeys: { siteName: "shop:config:site-name" },
          fields: { siteName: { type: "text" } } as never,
          layout: { sections: [{ title: "Basics", fields: ["siteName"] }] } as never,
          actions: actions as never,
        });
      });
    }
    const probe = {
      id: "probe",
      handler: "shop:write:probe",
      label: "shop.probe.label",
      buttonLabel: "shop.probe.button",
      afterField: "siteName",
    };

    test("a registered write handler and a layout field → no throw", () => {
      expect(() => validateBoot([actionFeature([probe])])).not.toThrow();
    });

    test("an unregistered handler → throws", () => {
      expect(() => validateBoot([actionFeature([probe], false)])).toThrow(
        /action "probe" → handler "shop:write:probe" is not a registered write handler/,
      );
    });

    test("an afterField outside the layout → throws", () => {
      expect(() => validateBoot([actionFeature([{ ...probe, afterField: "ghost" }])])).toThrow(
        /action "probe" afterField "ghost" is not a field of the layout/,
      );
    });

    test("duplicate ids → throws", () => {
      expect(() => validateBoot([actionFeature([probe, probe])])).toThrow(
        /action id "probe" is declared twice/,
      );
    });
  });

  test("mode: wizard with only 1 section → throws", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          mode: "wizard",
          sections: [{ title: "Basics", fields: ["siteName"] }],
        }),
      ]),
    ).toThrow(/\(configEdit\).*mode: "wizard" but only 1 section\(s\)/);
  });

  test("draft: true without a mounted form-draft feature → throws", () => {
    const sections = [
      { title: "Step 1", fields: ["siteName"] },
      { title: "Step 2", fields: ["maxUploadMb"] },
    ];
    expect(() => validateBoot([makeFeature({ mode: "wizard", sections, draft: true })])).toThrow(
      /"form-draft" is not mounted/,
    );
  });
});
