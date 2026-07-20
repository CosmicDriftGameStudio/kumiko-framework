// Boot-Check Sample — Test
// Proves: boot succeeds when the companion feature is mounted, fails with a
// clear, feature-prefixed message when it's missing.

import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { promptStoreFeature, userDataHookFeature } from "../feature";

describe("prompt-store bootCheck", () => {
  test("companion mounted → boot succeeds", () => {
    expect(() => validateBoot([userDataHookFeature, promptStoreFeature])).not.toThrow();
  });

  test("companion missing → boot fails with feature-prefixed message", () => {
    expect(() => validateBoot([promptStoreFeature])).toThrow(
      "[Feature prompt-store] r.bootCheck failed: prompt-store has PII fields but no user-data-hook feature is mounted",
    );
  });
});
