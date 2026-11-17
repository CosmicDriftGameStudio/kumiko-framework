import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { requiredKeysFromFeature } from "../../i18n/required-surface-keys.ts";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { buildAppSchema } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createSelectField, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function shopFeature(options: {
  readonly labelEntity?: string;
  readonly fieldLabels?: Record<string, string>;
}) {
  return defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "order",
        fields: {
          status: createSelectField({ options: ["open", "done"] as const }),
          note: createTextField({ personal: false, reason: "test_fixture" }),
        },
      }),
    );
    r.writeHandler({
      name: "set-status",
      schema: z.object({ status: z.string(), comment: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "set-status",
      type: "actionForm",
      handler: "shop:write:set-status",
      fields: {
        status: { type: "select", options: ["open", "done"] },
        comment: { type: "text" },
      },
      layout: { sections: [{ fields: ["status", "comment"] }] },
      ...(options.labelEntity !== undefined && { labelEntity: options.labelEntity }),
      ...(options.fieldLabels !== undefined && { fieldLabels: options.fieldLabels }),
    });
  });
}

function projectedScreen(feature: ReturnType<typeof shopFeature>): object {
  const screen = buildAppSchema(createRegistry([feature]))
    .features.find((f) => f.featureName === "shop")
    ?.screens.find((s) => s.id.endsWith(":set-status") || s.id === "set-status");
  if (screen === undefined) throw new Error("screen shop/set-status not projected");
  return screen;
}

describe("actionForm labelEntity", () => {
  test("an entity of the same feature boots", () => {
    expect(() => validateBoot([shopFeature({ labelEntity: "order" })])).not.toThrow();
  });

  test("an unknown entity fails the boot", () => {
    expect(() => validateBoot([shopFeature({ labelEntity: "invoice" })])).toThrow(
      /labelEntity "invoice" is not an entity of this feature/,
    );
  });

  test("buildAppSchema projects the form fields the entity declares", () => {
    const screen = projectedScreen(shopFeature({ labelEntity: "order" }));
    expect("labelEntityFields" in screen ? screen.labelEntityFields : undefined).toEqual([
      "status",
    ]);
  });

  test("without labelEntity the projected screen has no labelEntityFields", () => {
    const screen = projectedScreen(shopFeature({}));
    expect("labelEntityFields" in screen).toBe(false);
  });

  test("required keys use the entity keys for shared fields and __action-form__ keys for the rest", () => {
    const keys = requiredKeysFromFeature(shopFeature({ labelEntity: "order" }));
    expect(keys).toContain("shop:entity:order:field:status");
    expect(keys).toContain("shop:entity:__action-form__:field:comment");
    expect(keys).not.toContain("shop:entity:__action-form__:field:status");
  });

  test("a fieldLabels entry still wins over the entity key", () => {
    const keys = requiredKeysFromFeature(
      shopFeature({ labelEntity: "order", fieldLabels: { status: "shop:set-status.status" } }),
    );
    expect(keys).toContain("shop:set-status.status");
    expect(keys).not.toContain("shop:entity:order:field:status");
  });
});
