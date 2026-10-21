// Boot-validator tests for r.exposesApi / r.usesApi.
//
// Required validations (error / throw):
//   - r.usesApi(name) without a matching r.exposesApi(name) → throw
//   - r.usesApi(name) without r.requires(providerFeature) → throw
//   - r.exposesApi(name) called twice in one feature → throw
//   - Global duplicate exposure (two features, same name) → throw
//
// Soft warning (console.warn):
//   - A feature calls its own exposesApi via usesApi (refactor leftover)

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";

describe("validateBoot — r.exposesApi / r.usesApi", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("matching exposesApi/usesApi with requires() passes", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.requires({ features: ["compliance-profiles"] });
      r.usesApi("compliance.forTenant");
    });
    expect(() => validateBoot([provider, consumer])).not.toThrow();
  });

  test("matching exposesApi/usesApi with optionalRequires() passes", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.optionalRequires("compliance-profiles");
      r.usesApi("compliance.forTenant");
    });
    expect(() => validateBoot([provider, consumer])).not.toThrow();
  });

  test("usesApi without any exposer throws with known-list", () => {
    const consumer = defineFeature("user-data-rights", (r) => {
      r.usesApi("compliance.forTenant");
    });
    expect(() => validateBoot([consumer])).toThrow(
      /r\.usesApi\("compliance\.forTenant"\) but no feature exposes that API/,
    );
  });

  test("usesApi with typo throws and lists known APIs", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.requires({ features: ["compliance-profiles"] });
      r.usesApi("compliance.fortenant"); // typo: lowercase t
    });
    expect(() => validateBoot([provider, consumer])).toThrow(
      /Known exposed APIs: compliance\.forTenant/,
    );
  });

  test("usesApi exists but missing requires() throws", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      // missing r.requires({ features: ["compliance-profiles"] })
      r.usesApi("compliance.forTenant");
    });
    expect(() => validateBoot([provider, consumer])).toThrow(
      /not in requires\/optionalRequires\. Add r\.requires\(\{ features: \["compliance-profiles"\] \}\)/,
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
      r.usesApi("self.api");
    });
    validateBoot([f]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("typically a refactor leftover"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("feature with no API surface boots clean (regression guard)", () => {
    const plain = defineFeature("plain", (r) => {
      r.requires({ features: [] });
    });
    expect(() => validateBoot([plain])).not.toThrow();
  });

  test("global double-exposure throws before consumer-resolution kicks in", () => {
    // Edge case: two features expose the same name and a third feature
    // calls it. The duplicate-exposure error must be thrown during the
    // pre-walk (validateBoot), before validateApiExposureMatching runs.
    const a = defineFeature("provider-a", (r) => {
      r.exposesApi("shared.api");
    });
    const b = defineFeature("provider-b", (r) => {
      r.exposesApi("shared.api");
    });
    const consumer = defineFeature("consumer", (r) => {
      r.requires({ features: ["provider-a"] });
      r.usesApi("shared.api");
    });
    expect(() => validateBoot([a, b, consumer])).toThrow(
      /Cross-feature API "shared\.api" exposed by both/,
    );
  });
});
