// Boot-Validator-Tests fuer r.exposesApi / r.usesApi (S0.4).
//
// Pflicht-Validierungen (Error / throw):
//   - r.usesApi(name) ohne passenden r.exposesApi(name) → throw
//   - r.usesApi(name) ohne r.requires(providerFeature) → throw
//   - r.exposesApi(name) zweimal in einem Feature → throw
//   - Globale Doppel-Exposure (zwei Features, gleicher Name) → throw
//
// Soft-Warning (console.warn):
//   - Feature ruft eigene exposesApi via usesApi (Refactor-Leftover)

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";

describe("validateBoot — r.exposesApi / r.usesApi", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("matching exposesApi/usesApi with requires() passes", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant", () => "ok");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.requires("compliance-profiles");
      r.usesApi("compliance.forTenant");
    });
    expect(() => validateBoot([provider, consumer])).not.toThrow();
  });

  test("matching exposesApi/usesApi with optionalRequires() passes", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant", () => "ok");
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
      r.exposesApi("compliance.forTenant", () => "ok");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      r.requires("compliance-profiles");
      r.usesApi("compliance.fortenant"); // typo: lowercase t
    });
    expect(() => validateBoot([provider, consumer])).toThrow(
      /Known exposed APIs: compliance\.forTenant/,
    );
  });

  test("usesApi exists but missing requires() throws", () => {
    const provider = defineFeature("compliance-profiles", (r) => {
      r.exposesApi("compliance.forTenant", () => "ok");
    });
    const consumer = defineFeature("user-data-rights", (r) => {
      // missing r.requires("compliance-profiles")
      r.usesApi("compliance.forTenant");
    });
    expect(() => validateBoot([provider, consumer])).toThrow(
      /not in requires\/optionalRequires\. Add r\.requires\("compliance-profiles"\)/,
    );
  });

  test("exposesApi twice in same feature throws", () => {
    expect(() =>
      defineFeature("dup", (r) => {
        r.exposesApi("api.foo", () => 1);
        r.exposesApi("api.foo", () => 2);
      }),
    ).toThrow(/r\.exposesApi\("api\.foo"\) called twice/);
  });

  test("two features expose the same API throws on boot", () => {
    const a = defineFeature("a", (r) => {
      r.exposesApi("shared.api", () => "a");
    });
    const b = defineFeature("b", (r) => {
      r.exposesApi("shared.api", () => "b");
    });
    expect(() => validateBoot([a, b])).toThrow(
      /Cross-feature API "shared\.api" exposed by both "a" and "b"/,
    );
  });

  test("self-exposure (feature uses its own exposed API) warns", () => {
    const f = defineFeature("self-loop", (r) => {
      r.exposesApi("self.api", () => "x");
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
      r.requires();
    });
    expect(() => validateBoot([plain])).not.toThrow();
  });
});
