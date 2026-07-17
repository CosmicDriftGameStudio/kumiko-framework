// Boot-Validator-Tests fuer r.exposesApi / r.requires(name, { apis }) (S0.4).
//
// Pflicht-Validierungen (Error / throw):
//   - r.requires(name, { apis }) ohne passenden r.exposesApi(name) → throw
//   - r.exposesApi(name) zweimal in einem Feature → throw
//   - Globale Doppel-Exposure (zwei Features, gleicher Name) → throw
//
// Soft-Warning (console.warn):
//   - Feature ruft eigene exposesApi via requires(self, {apis}) (Refactor-Leftover)

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";

describe("validateBoot — r.exposesApi / r.requires(name, { apis })", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("matching exposesApi/requires({apis}) passes", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.requires("compliance-profiles", { apis: ["compliance.forTenant"] });
    });
    expect(() => validateBoot([provider, consumer])).not.toThrow();
  });

  test("matching exposesApi/requires({apis}) via optionalRequires passes", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.optionalRequires("compliance-profiles", { apis: ["compliance.forTenant"] });
    });
    expect(() => validateBoot([provider, consumer])).not.toThrow();
  });

  test("requires({apis}) without any exposer throws with known-list", () => {
    const consumer = defineFeature("user-data-rights", (r) => {
      r.requires("compliance-profiles", { apis: ["compliance.forTenant"] });
    });
    expect(() => validateBoot([consumer])).toThrow(
      /r\.requires\(\.\.\., \{ apis: \["compliance\.forTenant"\] \}\) but no feature exposes that API/,
    );
  });

  test("requires({apis}) with typo throws and lists known APIs", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.requires("compliance-profiles", { apis: ["compliance.fortenant"] }); // typo: lowercase t
    });
    expect(() => validateBoot([provider, consumer])).toThrow(
      /Known exposed APIs: compliance\.forTenant/,
    );
  });

  test("exposesApi twice in same feature throws", () => {
    expect(() =>
      defineFeature("dup", (r) => {
        r.exposesApi("api.foo");
        r.exposesApi("api.foo");
      }),
    ).toThrow(/r\.exposesApi\("api\.foo"\) called twice/);
  });

  test("two features expose the same API throws on boot", () => {
    const a = defineFeature("a", (r) => {
      r.exposesApi("shared.api");
    });
    const b = defineFeature("b", (r) => {
      r.exposesApi("shared.api");
    });
    expect(() => validateBoot([a, b])).toThrow(
      /Cross-feature API "shared\.api" exposed by both "a" and "b"/,
    );
  });

  test("self-exposure (feature uses its own exposed API) warns", () => {
    const f = defineFeature("self-loop", (r) => {
      r.exposesApi("self.api");
      r.requires("self-loop", { apis: ["self.api"] });
    });
    validateBoot([f]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("typically a refactor leftover"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("feature with no API surface boots clean (regression guard)", () => {
    const plain = defineFeature("plain", (r) => {
      r.requires();
    });
    expect(() => validateBoot([plain])).not.toThrow();
  });

  test("global double-exposure throws before consumer-resolution kicks in", () => {
    // Edge-case: zwei Features exposen denselben Namen UND ein drittes
    // Feature ruft den Namen. Erwartet: Doppel-Exposure-Error wirft im
    // Pre-Walk (validateBoot) BEVOR validateApiExposureMatching laeuft.
    const a = defineFeature("provider-a", (r) => {
      r.exposesApi("shared.api");
    });
    const b = defineFeature("provider-b", (r) => {
      r.exposesApi("shared.api");
    });
    const consumer = defineFeature("consumer", (r) => {
      r.requires("provider-a", { apis: ["shared.api"] });
    });
    expect(() => validateBoot([a, b, consumer])).toThrow(
      /Cross-feature API "shared\.api" exposed by both/,
    );
  });
});
