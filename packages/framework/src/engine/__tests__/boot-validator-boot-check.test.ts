// r.bootCheck(fn) — feature-declared mount invariants, checked at boot.
// Mirrors the prompt-store trap (kumiko-enterprise#229): a feature with
// PII-annotated fields was mounted without its required companion feature,
// and nothing caught it at boot. The conditional-invariant tests below
// reproduce that shape: the check only fails when the feature actually has
// PII fields AND the companion is missing — a bare "is X mounted" check
// would already be covered by r.requires and wouldn't justify this API.

import { describe, expect, test } from "bun:test";
import { validateFeatureBootChecks } from "../boot-validator/boot-check";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function catchMessage(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected function to throw, but it did not");
}

const requiresUserDataHook = (features: readonly { readonly name: string }[]) =>
  features.some((f) => f.name === "user-data-hook");

const promptStore = () =>
  defineFeature("prompt-store", (r) => {
    const promptFields = { text: createTextField({ pii: true }) };
    r.entity("prompt", createEntity({ fields: promptFields }));
    r.bootCheck(({ features }) => {
      // Conditional on this feature's own shape (has a pii field), closed
      // over from setup — r.requires("user-data-hook") can't express that.
      const hasPiiField = Object.values(promptFields).some((field) => field.pii);
      if (hasPiiField && !requiresUserDataHook(features)) {
        throw new Error("prompt-store has PII fields but no user-data-hook feature is mounted");
      }
    });
  });

describe("r.bootCheck / validateFeatureBootChecks", () => {
  test("no bootChecks registered → no-op", () => {
    const noop = defineFeature("noop", () => {});
    expect(() => validateFeatureBootChecks([noop])).not.toThrow();
  });

  test("conditional invariant satisfied (companion mounted) → boot succeeds", () => {
    const userDataHook = defineFeature("user-data-hook", () => {});
    expect(() => validateFeatureBootChecks([userDataHook, promptStore()])).not.toThrow();
  });

  test("conditional invariant violated (PII field, no companion) → boot fails with feature-prefixed message", () => {
    const message = catchMessage(() => validateFeatureBootChecks([promptStore()]));
    expect(message).toContain("[Feature prompt-store]");
    expect(message).toContain(
      "prompt-store has PII fields but no user-data-hook feature is mounted",
    );
  });

  test("no PII field → boot succeeds even without the companion", () => {
    const noPiiFields = { text: createTextField() };
    const noPii = defineFeature("prompt-store-no-pii", (r) => {
      r.entity("note", createEntity({ fields: noPiiFields }));
      r.bootCheck(({ features }) => {
        const hasPiiField = Object.values(noPiiFields).some((field) => field.pii);
        if (hasPiiField && !requiresUserDataHook(features)) {
          throw new Error("unreachable in this test");
        }
      });
    });
    expect(() => validateFeatureBootChecks([noPii])).not.toThrow();
  });

  test("multiple bootChecks on one feature all run in order until one throws", () => {
    const calls: string[] = [];
    const feature = defineFeature("multi-check", (r) => {
      r.bootCheck(() => {
        calls.push("first");
      });
      r.bootCheck(() => {
        calls.push("second");
        throw new Error("second check failed");
      });
    });
    expect(() => validateFeatureBootChecks([feature])).toThrow("second check failed");
    expect(calls).toEqual(["first", "second"]);
  });

  test("ctx.features exposes every mounted feature, not just the declaring one", () => {
    const a = defineFeature("feature-a", () => {});
    let seenNames: string[] = [];
    const b = defineFeature("feature-b", (r) => {
      r.bootCheck(({ features }) => {
        seenNames = features.map((f) => f.name);
      });
    });
    validateFeatureBootChecks([a, b]);
    expect(seenNames).toEqual(["feature-a", "feature-b"]);
  });
});
