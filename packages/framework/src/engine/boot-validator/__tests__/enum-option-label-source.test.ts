import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createSelectField, createTextField } from "../../factories.ts";
import { BootValidationError } from "../boot-rule.ts";

const RULE_ID = "screen/enum-option-label-source-invalid";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function ruleIdsOf(fn: () => void): readonly string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  throw new Error("expected BootValidationError");
}

// The boot validator is the net for configs the type system never sees, so the renderer
// arrives as an untyped object.
function screenFeature(renderer: object) {
  return defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "order",
        fields: {
          status: createSelectField({
            options: ["open", "done"] as const,
            default: "open",
            sortable: true,
          }),
          note: createTextField({ personal: false, reason: "test_fixture" }),
        },
      }),
    );
    r.screen({
      id: "order-list",
      type: "entityList",
      entity: "order",
      columns: [{ field: "status", renderer }],
      defaultSort: { field: "status", direction: "asc" },
    } as never);
  });
}

describe("validateBoot — enumOption label source", () => {
  test("optionsOf naming a select field boots", () => {
    expect(() =>
      validateBoot([screenFeature({ format: "enumOption", optionsOf: "shop:order.status" })]),
    ).not.toThrow();
  });

  test.each([
    ["an unknown field", { format: "enumOption", optionsOf: "shop:order.statuss" }],
    ["a text field", { format: "enumOption", optionsOf: "shop:order.note" }],
    ["a ref without the feature", { format: "enumOption", optionsOf: "order.status" }],
    [
      "keyPrefix and optionsOf together",
      { format: "enumOption", keyPrefix: "x:", optionsOf: "shop:order.status" },
    ],
    ["neither keyPrefix nor optionsOf", { format: "enumOption" }],
  ])("%s is rejected", (_name, renderer) => {
    expect(ruleIdsOf(() => validateBoot([screenFeature(renderer)]))).toContain(RULE_ID);
  });
});
