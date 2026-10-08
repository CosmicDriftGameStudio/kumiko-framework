import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture.js";
import { validateBoot as validateBootRaw } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("validateBoot — column sortable only applies to relatedList columns", () => {
  test("projectionList column with sortable → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.queryHandler("products", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "product-projection",
        type: "projectionList",
        query: "shop:query:products",
        columns: [{ field: "name", sortable: true }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/column "name" sets sortable/);
  });

  test("entityList column with sortable → Throw naming the entity-field flag", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: {
            name: createTextField({ personal: false, reason: "test_fixture", sortable: true }),
          },
        }),
      );
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: [{ field: "name", sortable: true }],
        defaultSort: { field: "name", dir: "asc" },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/entity field instead/);
  });
});
