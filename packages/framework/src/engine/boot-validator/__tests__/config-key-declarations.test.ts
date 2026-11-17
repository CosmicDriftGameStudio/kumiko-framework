import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { createSystemConfig, createTenantConfig } from "../../config-helpers.ts";
import { defineFeature } from "../../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

test("throws when readsConfig references non-existent key", () => {
  const features = [
    defineFeature("invoicing", (r) => {
      r.readsConfig({ keys: ["payments.gateway"] });
    }),
  ];
  expect(() => validateBoot(features)).toThrow(
    /invoicing.*reads config "payments.gateway".*no feature defines/i,
  );
});

test("passes when readsConfig references existing key", () => {
  const features = [
    defineFeature("payments", (r) => {
      r.config({
        keys: {
          gateway: {
            type: "text",
            allowPlaintext: "test fixture value, not personal data",
            scope: "tenant",
            access: { read: ["all"], write: ["Admin"] },
          },
        },
      });
    }),
    defineFeature("invoicing", (r) => {
      r.requires({ features: ["payments"] });
      r.readsConfig({ keys: ["payments.gateway"] });
    }),
  ];
  expect(() => validateBoot(features)).not.toThrow();
});

describe("config key bounds consistency", () => {
  test("accepts number key with consistent bounds + default", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            maxUploadMB: createTenantConfig("number", {
              default: 10,
              bounds: { min: 1, max: 100 },
            }),
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("rejects min > max", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            weird: createTenantConfig("number", { bounds: { min: 100, max: 10 } }),
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/bounds\.min.*>.*bounds\.max/i);
  });

  test("rejects default below min", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            tooLow: createTenantConfig("number", {
              default: 0,
              bounds: { min: 1, max: 100 },
            }),
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/default.*below bounds\.min/i);
  });

  test("rejects default above max", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            tooHigh: createSystemConfig("number", {
              default: 200,
              bounds: { max: 100 },
            }),
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/default.*above bounds\.max/i);
  });

  test("accepts partial bounds (only min)", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            lowerOnly: createTenantConfig("number", {
              default: 5,
              bounds: { min: 1 },
            }),
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("accepts bounds without default (bound-only key)", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            bounded: createTenantConfig("number", { bounds: { min: 1, max: 100 } }),
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("rejects bounds on non-number key (defence in depth against hand-rolled definitions)", () => {
    const features = [
      defineFeature("files", (r) => {
        // Cast needed because type-level guard rejects this at the call site.
        // Boot validator catches the same class of bug when someone bypasses
        // the helper (e.g. importing a plain ConfigKeyDefinition object).
        r.config({
          keys: {
            textKey: {
              type: "text",
              allowPlaintext: "test fixture value, not personal data",
              scope: "tenant",
              access: { read: ["all"], write: ["all"] },
              bounds: { min: 1 },
            } as never,
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/bounds.*only valid for type="number"/i);
  });
});

describe("config key computed + encrypted exclusivity", () => {
  test("rejects encrypted + computed combination", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            mixed: {
              type: "text",
              allowPlaintext: "test fixture value, not personal data",
              scope: "tenant",
              access: { read: ["all"], write: ["all"] },
              encrypted: true,
              computed: async () => "x",
            } as never,
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/encrypted.*computed.*mutually exclusive/i);
  });

  test("accepts computed without encrypted (normal plan-based use-case)", () => {
    const features = [
      defineFeature("files", (r) => {
        r.config({
          keys: {
            planBased: createTenantConfig("number", {
              default: 10,
              computed: async () => 100,
            }),
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });
});

describe("config key backing × scope", () => {
  test("rejects backing:secrets on a non-system scope (secrets do not cascade)", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createTenantConfig("text", { backing: "secrets" }) } });
    });
    expect(() => validateBoot([feature])).toThrow(/backing="secrets".*requires scope="system"/i);
  });

  test("allows backing:secrets when system-scoped (dispatch is wired)", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createSystemConfig("text", { backing: "secrets" }) } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("a config key without secrets backing boots fine", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({ keys: { apiKey: createSystemConfig("text") } });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
