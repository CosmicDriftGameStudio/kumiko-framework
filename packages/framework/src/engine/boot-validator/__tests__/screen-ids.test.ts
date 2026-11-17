import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  describe("screen short-id collisions across features", () => {
    test("two features registering the same short screen-id → Throw", () => {
      const a = defineFeature("shop", (r) => {
        r.screen({ id: "settings", type: "custom", renderer: { react: "stub" } });
      });
      const b = defineFeature("billing", (r) => {
        r.screen({ id: "settings", type: "custom", renderer: { react: "stub" } });
      });
      expect(() => validateBoot([a, b])).toThrow(
        /Screen short-id "settings" is registered by 2 features \(shop, billing\)/,
      );
    });

    test("distinct short-ids across features → no throw", () => {
      const a = defineFeature("shop", (r) => {
        r.screen({ id: "shop-settings", type: "custom", renderer: { react: "stub" } });
      });
      const b = defineFeature("billing", (r) => {
        r.screen({ id: "billing-settings", type: "custom", renderer: { react: "stub" } });
      });
      expect(() => validateBoot([a, b])).not.toThrow();
    });
  });

  // The renderer uses `screen.id` as the URL parameter namespace (`<id>.sort=…`).
  // `defineFeature()` rejects IDs containing `.` through its kebab-case check,
  // before the boot validator runs; this verifies that the authoring API rejects
  // them at its entry point with a clear message.
  describe("screen.id constraints", () => {
    test('screen.id with "." → defineFeature throws (kebab-case)', () => {
      expect(() =>
        defineFeature("shop", (r) => {
          r.entity(createEntity({
              name: "product",
              fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            }));
          r.screen({
            id: "product.list",
            type: "entityList",
            entity: "product",
            columns: ["name"],
          });
        }),
      ).toThrow(/kebab-case/);
    });

    test("screen.id in kebab-case → no throw", () => {
      const feature = defineFeature("shop", (r) => {
        r.entity(createEntity({
            name: "product",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }));
        r.screen({ id: "product-list", type: "entityList", entity: "product", columns: ["name"] });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    });
  });
