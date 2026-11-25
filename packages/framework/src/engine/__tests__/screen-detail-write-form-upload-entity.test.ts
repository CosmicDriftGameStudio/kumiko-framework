import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createFileField, createTextField } from "../factories.ts";
import { registerStubQueryHandler } from "./stub-query-handler.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("projectionDetail writeForm file fields need an uploadEntity", () => {
  const featuresFor = (uploadEntity: string | undefined, formField = "attachment") => [
    defineFeature("app", (r) => {
      registerStubQueryHandler(r, "foo:detail");
      r.entity(
        createEntity({
          name: "dossier",
          table: "upload_dossiers",
          fields: {
            title: createTextField({ personal: false, reason: "test_fixture" }),
            attachment: createFileField(),
          },
        }),
      );
      r.screen({
        id: "x",
        type: "projectionDetail",
        query: "app:query:foo:detail",
        layout: {
          sections: [
            {
              kind: "writeForm",
              title: "s",
              ...(uploadEntity !== undefined && { uploadEntity }),
              fieldDefs: { [formField]: createFileField() },
              fields: [formField],
              handler: "app:write:save",
            },
          ],
        },
      });
    }),
  ];

  test("a file field without uploadEntity fails boot", () => {
    expect(() => validateBoot(featuresFor(undefined))).toThrow(
      /file field "attachment" but no uploadEntity/,
    );
  });

  test("an uploadEntity that is not a registered entity fails boot", () => {
    expect(() => validateBoot(featuresFor("ghost"))).toThrow(
      /uploadEntity "ghost", which is not a registered entity/,
    );
  });

  test("an uploadEntity without a file field of that name fails boot", () => {
    expect(() => validateBoot(featuresFor("dossier", "title"))).toThrow(
      /file field "title", but entity "dossier" has no file field/,
    );
  });
});
