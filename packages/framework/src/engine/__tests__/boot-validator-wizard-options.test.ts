import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import type { EditLayout, EditSectionSpec } from "../types/screen.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const textField = () => createTextField({ personal: false, reason: "test_fixture" });

function featureWith(layout: EditLayout) {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "product",
      ...createEntity({ fields: { name: textField(), note: textField() } }),
    });
    r.screen({ id: "product-edit", type: "entityEdit", entity: "product", layout });
  });
}

const sections = (first: Partial<EditSectionSpec> = {}): readonly EditSectionSpec[] => [
  { title: "Step 1", fields: ["name"], ...first } as EditSectionSpec,
  { title: "Step 2", fields: ["note"] },
];

describe("validateBoot: wizard layout options", () => {
  test("valid wizard options boot cleanly", () => {
    expect(() =>
      validateBoot([
        featureWith({
          mode: "wizard",
          sections: sections({ summaryField: "name" }),
          wizard: {
            aside: { upNext: true, finishDescription: "shop.finish" },
            saveAndCloseOnCreate: true,
            submitDisabledWhen: { field: "note", eq: "x" },
          },
        }),
      ]),
    ).not.toThrow();
  });

  test("summaryField outside the section fails boot", () => {
    expect(() =>
      validateBoot([featureWith({ mode: "wizard", sections: sections({ summaryField: "note" }) })]),
    ).toThrow(/summaryField "note", which is not a field of that section/);
  });

  test("submitDisabledWhen on an unknown field fails boot", () => {
    expect(() =>
      validateBoot([
        featureWith({
          mode: "wizard",
          sections: sections(),
          wizard: { submitDisabledWhen: { field: "ghost", eq: 1 } },
        }),
      ]),
    ).toThrow(/submitDisabledWhen names field "ghost"/);
  });

  test("wizard-only options without mode wizard fail boot", () => {
    expect(() =>
      validateBoot([featureWith({ sections: sections(), wizard: { saveAndCloseOnCreate: true } })]),
    ).toThrow(/wizard-only layout option but mode is not "wizard"/);
    expect(() =>
      validateBoot([featureWith({ sections: sections({ summaryField: "name" }) })]),
    ).toThrow(/wizard-only layout option but mode is not "wizard"/);
  });
});
