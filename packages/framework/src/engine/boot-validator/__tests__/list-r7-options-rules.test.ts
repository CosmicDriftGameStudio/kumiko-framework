// Boot rules of the board-gap options: reason box fields, toolbar create placement, toolbar sort.
import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { BootValidationError } from "../boot-rule.ts";

function ruleIdsOf(features: Parameters<typeof validateBootRaw>[0]): readonly string[] {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  return [];
}

function entityListFeature(screen: Record<string, unknown>) {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "item",
      ...createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    });
    r.screen({
      id: "item-list",
      type: "entityList",
      entity: "item",
      columns: ["name"],
      defaultSort: { field: "name", dir: "asc" },
      ...screen,
    } as never);
  });
}

describe("reason box options", () => {
  test("reasonOpenField and reasonTitleField need reasonField", () => {
    const ids = ruleIdsOf([
      entityListFeature({ columns: [{ field: "name", hint: { reasonOpenField: "name" } }] }),
    ]);
    expect(ids).toContain("list/reason-option-without-reason-field");
    const ok = ruleIdsOf([
      entityListFeature({
        columns: [{ field: "name", hint: { reasonField: "name", reasonTitleField: "name" } }],
      }),
    ]);
    expect(ok).not.toContain("list/reason-option-without-reason-field");
  });
});

describe("entity list toolbar options", () => {
  test("createPlacement toolbar needs a create button", () => {
    expect(
      ruleIdsOf([entityListFeature({ createPlacement: "toolbar", allowCreate: false })]),
    ).toContain("entity-list/create-placement-without-create");
    expect(ruleIdsOf([entityListFeature({ createPlacement: "toolbar" })])).not.toContain(
      "entity-list/create-placement-without-create",
    );
  });

  test("toolbarSort needs sortOptions", () => {
    expect(ruleIdsOf([entityListFeature({ toolbarSort: true })])).toContain(
      "entity-list/toolbar-sort-without-sort-options",
    );
    expect(
      ruleIdsOf([
        entityListFeature({
          toolbarSort: true,
          sortOptions: [{ field: "name", dir: "asc", label: "shop:sort:name" }],
        }),
      ]),
    ).not.toContain("entity-list/toolbar-sort-without-sort-options");
  });
});
