import { describe, expect, test } from "bun:test";
import type { EditFieldSpec } from "@cosmicdrift/kumiko-types/screen";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import {
  createDateField,
  createEmbeddedListField,
  createEntity,
  createTextField,
} from "../factories.js";

function featureWith(
  field: Exclude<EditFieldSpec, string>,
  screenExtras: { readonly readOnly?: { readonly field: string; readonly eq: unknown } } = {},
) {
  return defineFeature("demo", (r) => {
    r.entity(
      "protocol",
      createEntity({
        table: "Protocols",
        fields: {
          inspector: createTextField({ personal: false, reason: "test_fixture" }),
          day: createDateField(),
          checkpoints: createEmbeddedListField({
            text: { type: "text" },
            result: { type: "select", options: ["ok", "bad"], display: "radio" },
          }),
        },
      }),
    );
    r.screen({
      id: "protocol-edit",
      type: "entityEdit",
      entity: "protocol",
      ...screenExtras,
      layout: { sections: [{ fields: [field] }] },
    });
    r.translations({
      keys: {
        "screen:protocol-edit.title": { de: "Protokoll", en: "Protocol" },
        "demo:entity:protocol:field:inspector": { de: "Prüfer", en: "Inspector" },
        "demo:entity:protocol:field:day": { de: "Tag", en: "Day" },
        "demo:entity:protocol:field:checkpoints": { de: "Punkte", en: "Checkpoints" },
      },
    });
  });
}

describe("validateBoot — entityEdit embeddedList / prefill / readOnly", () => {
  test("embeddedList on a list field with known cells passes", () => {
    const feature = featureWith({
      field: "checkpoints",
      embeddedList: { readOnlyCells: ["text"], fixedRows: true },
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("embeddedList on a non-list field fails", () => {
    const feature = featureWith({ field: "inspector", embeddedList: { fixedRows: true } });
    expect(() => validateBoot([feature])).toThrow(/embeddedList, which only applies/);
  });

  test("readOnlyCells naming an unknown sub-field fails", () => {
    const feature = featureWith({
      field: "checkpoints",
      embeddedList: { readOnlyCells: ["nope"] },
    });
    expect(() => validateBoot([feature])).toThrow(/readOnlyCells names "nope"/);
  });

  test("prefill today needs a date field", () => {
    expect(() =>
      validateBoot([featureWith({ field: "day", prefill: { kind: "today" } })]),
    ).not.toThrow();
    expect(() =>
      validateBoot([featureWith({ field: "inspector", prefill: { kind: "today" } })]),
    ).toThrow(/prefill "today" needs a date field/);
  });

  test("prefill currentUser needs a text field", () => {
    expect(() =>
      validateBoot([
        featureWith({
          field: "inspector",
          prefill: { kind: "currentUser", property: "displayName" },
        }),
      ]),
    ).not.toThrow();
    expect(() =>
      validateBoot([
        featureWith({ field: "day", prefill: { kind: "currentUser", property: "email" } }),
      ]),
    ).toThrow(/currentUser\.email does not fit/);
  });

  test("screen readOnly condition on an unknown field fails", () => {
    const feature = featureWith({ field: "inspector" }, { readOnly: { field: "ghost", eq: true } });
    expect(() => validateBoot([feature])).toThrow(/readOnly condition field "ghost"/);
  });
});
