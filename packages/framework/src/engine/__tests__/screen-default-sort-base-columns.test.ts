import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function productEntity() {
  return createEntity({
    name: "product",
    table: "products",
    fields: {
      name: createTextField({ personal: false, reason: "test_fixture" }),
    },
  });
}

function featureWithDefaultSort(field: string, columns: readonly string[]) {
  return defineFeature("shop", (r) => {
    r.entity(productEntity());
    r.screen({
      id: "list",
      type: "entityList",
      entity: "product",
      columns,
      defaultSort: { field, dir: "desc" },
    });
  });
}

describe("validateBoot — entityList defaultSort on base columns", () => {
  test("entityList defaultSort on the insertedAt base column boots", () => {
    expect(() =>
      validateBoot([featureWithDefaultSort("insertedAt", ["name", "insertedAt"])]),
    ).not.toThrow();
  });

  test("entityList defaultSort on a name that is neither field nor base column fails boot", () => {
    expect(() => validateBoot([featureWithDefaultSort("createdAt", ["name"])])).toThrow(
      /defaultSort references unknown field "createdAt"/,
    );
  });
});
