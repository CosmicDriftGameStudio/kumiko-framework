import { describe, expect, test } from "bun:test";
import {
  BootValidationError,
  defineFeature,
  EXT_ASSIGNABLE_ROLE,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { createConfigFeature } from "../../config/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createTenantFeature } from "../feature.ts";

describe("tenant boot rules", () => {
  test("an assignable role missing from the screens violates assignable-role-missing-from-screens", () => {
    const app = defineFeature("assignable-rule-app", (r) => {
      r.requires({ features: ["tenant"] });
      r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager");
    });
    const error = (() => {
      try {
        validateBoot([createConfigFeature(), createUserFeature(), createTenantFeature(), app]);
      } catch (thrown) {
        if (thrown instanceof BootValidationError) return thrown;
        throw thrown;
      }
      throw new Error("expected validateBoot to throw");
    })();
    expect(error.violations.map((violation) => violation.ruleId)).toEqual([
      "tenant/assignable-role-missing-from-screens",
    ]);
    expect(error.message).toContain('assignable app role "PropertyManager"');
  });
});
