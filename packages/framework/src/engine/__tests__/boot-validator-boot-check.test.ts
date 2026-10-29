// r.bootCheck(fn) — feature-declared mount invariants, checked at boot.
// Mirrors the prompt-store trap: a feature with
// PII-annotated fields was mounted without its required companion feature,
// and nothing caught it at boot. The conditional-invariant tests below
// reproduce that shape: the check only fails when the feature actually has
// PII fields AND the companion is missing — a bare "is X mounted" check
// would already be covered by r.requires and wouldn't justify this API.

import { describe, expect, test } from "bun:test";
import { BootValidationError } from "../boot-validator/boot-rule.ts";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";

// Messages of the r.bootCheck violations only: the fixtures here are not meant to satisfy every other boot rule.
function bootCheckMessages(features: Parameters<typeof validateBoot>[0]): string[] {
  try {
    validateBoot(features);
  } catch (e) {
    if (e instanceof BootValidationError) {
      return e.violations.filter((v) => v.check === "runFeatureBootCheck").map((v) => v.message);
    }
    throw e;
  }
  return [];
}

const requiresUserDataHook = (features: readonly { readonly name: string }[]) =>
  features.some((f) => f.name === "user-data-hook");

const promptStore = () =>
  defineFeature("prompt-store", (r) => {
    const promptFields = {
      text: createTextField({
        personal: "self",
        find: "none",
      }),
    };
    r.entity({ name: "prompt", ...createEntity({ fields: promptFields }) });
    r.bootCheck(({ features }) => {
      // Conditional on this feature's own shape (has a pii field), closed
      // over from setup — r.requires({ features: ["user-data-hook"] }) can't express that.
      const hasPiiField = Object.values(promptFields).some((field) => field.pii);
      if (hasPiiField && !requiresUserDataHook(features)) {
        throw new Error("prompt-store has PII fields but no user-data-hook feature is mounted");
      }
    });
  });

describe("r.bootCheck / validateFeatureBootChecks", () => {
  test("no bootChecks registered → no-op", () => {
    const noop = defineFeature("noop", () => {});
    expect(bootCheckMessages([noop])).toEqual([]);
  });

  test("conditional invariant satisfied (companion mounted) → boot succeeds", () => {
    const userDataHook = defineFeature("user-data-hook", () => {});
    expect(bootCheckMessages([userDataHook, promptStore()])).toEqual([]);
  });

  test("conditional invariant violated (PII field, no companion) → boot fails with feature-prefixed message", () => {
    const [message, ...rest] = bootCheckMessages([promptStore()]);
    expect(rest).toEqual([]);
    expect(message).toContain("[Feature prompt-store]");
    expect(message).toContain(
      "prompt-store has PII fields but no user-data-hook feature is mounted",
    );
  });

  test("a message ending in a period gets no doubled punctuation", () => {
    const feature = defineFeature("period-check", (r) => {
      r.bootCheck(() => {
        throw new Error("X is missing.");
      });
    });
    expect(bootCheckMessages([feature])).toEqual([
      "[Feature period-check] r.bootCheck failed: X is missing.",
    ]);
  });

  test("no PII field → boot succeeds even without the companion", () => {
    const noPiiFields = { text: createTextField({ personal: false, reason: "test_fixture" }) };
    const noPii = defineFeature("prompt-store-no-pii", (r) => {
      r.entity({ name: "note", ...createEntity({ fields: noPiiFields }) });
      r.bootCheck(({ features }) => {
        const hasPiiField = Object.values(noPiiFields).some((field) => field.pii);
        if (hasPiiField && !requiresUserDataHook(features)) {
          throw new Error("unreachable in this test");
        }
      });
    });
    expect(bootCheckMessages([noPii])).toEqual([]);
  });

  test("every failing bootCheck of a feature is reported, in order", () => {
    const calls: string[] = [];
    const feature = defineFeature("multi-check", (r) => {
      r.bootCheck(() => {
        calls.push("first");
        throw new Error("first check failed");
      });
      r.bootCheck(() => {
        calls.push("second");
      });
      r.bootCheck(() => {
        calls.push("third");
        throw new Error("third check failed");
      });
    });
    expect(bootCheckMessages([feature])).toEqual([
      "[Feature multi-check] r.bootCheck failed: first check failed",
      "[Feature multi-check] r.bootCheck failed: third check failed",
    ]);
    expect(calls).toEqual(["first", "second", "third"]);
  });

  test("ctx.features exposes every mounted feature, not just the declaring one", () => {
    const a = defineFeature("feature-a", () => {});
    let seenNames: string[] = [];
    const b = defineFeature("feature-b", (r) => {
      r.bootCheck(({ features }) => {
        seenNames = features.map((f) => f.name);
      });
    });
    bootCheckMessages([a, b]);
    expect(seenNames).toEqual(["feature-a", "feature-b"]);
  });
});
