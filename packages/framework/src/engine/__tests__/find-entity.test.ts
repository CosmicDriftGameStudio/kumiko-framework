import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import { findEntity } from "../find-entity.ts";

const shop = defineFeature("shop", (r) => {
  r.entity({
    name: "product",
    ...createEntity({
      table: "products",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  });
});
const features = new Map([[shop.name, shop]]);

describe("findEntity", () => {
  test("finds a registered entity", () => {
    expect(findEntity(features, "product")?.table).toBe("products");
  });

  test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "an Object.prototype member name (%s) is not an entity",
    (name) => {
      expect(findEntity(features, name)).toBeUndefined();
    },
  );
});
