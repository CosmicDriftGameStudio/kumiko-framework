import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature.ts";
import {
  createEmbeddedListField,
  createEntity,
  createMultiSelectField,
  createSelectField,
  createTextField,
} from "../../factories.ts";
import { validateFieldValueTranslations } from "../i18n-keys.ts";

const base = "shop:entity:order:field";

function shopWith(translationKeys: readonly string[]) {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "order",
      ...createEntity({
        fields: {
          title: createTextField({ personal: false, reason: "test_fixture" }),
          status: createSelectField({ options: ["open", "done"] as const }),
          tags: createMultiSelectField({ options: ["a", "b"] as const }),
          lines: createEmbeddedListField({
            label: { type: "text" },
            kind: { type: "select", options: ["goods", "service"] },
          }),
        },
      }),
    });
    r.screen({
      id: "order-list",
      type: "entityList",
      entity: "order",
      columns: ["title", "status"],
    });
    r.screen({
      id: "order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [{ fields: ["status", "lines"] }, { groups: [{ title: "x", fields: ["tags"] }] }],
      },
    });
    r.translations({
      keys: Object.fromEntries(translationKeys.map((key) => [key, { en: key }])),
    });
  });
}

const ALL_KEYS = [
  `${base}:status:option:open`,
  `${base}:status:option:done`,
  `${base}:tags:option:a`,
  `${base}:tags:option:b`,
  `${base}:lines:cell:label`,
  `${base}:lines:cell:kind`,
  `${base}:lines:cell:kind:option:goods`,
  `${base}:lines:cell:kind:option:service`,
];

describe("validateFieldValueTranslations", () => {
  test("is a no-op when the option is off or false", () => {
    const feature = shopWith([]);
    expect(() => validateFieldValueTranslations([feature], undefined)).not.toThrow();
    expect(() => validateFieldValueTranslations([feature], false)).not.toThrow();
  });

  test("passes when every option, group field and embedded cell key exists", () => {
    expect(() => validateFieldValueTranslations([shopWith(ALL_KEYS)], true)).not.toThrow();
  });

  test("reports all missing keys in one error", () => {
    const present = ALL_KEYS.filter(
      (k) => k !== `${base}:status:option:done` && !k.includes(":tags:"),
    );
    let message = "";
    try {
      validateFieldValueTranslations([shopWith(present)], true);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain(`${base}:status:option:done`);
    expect(message).toContain(`${base}:tags:option:a`);
    expect(message).toContain(`${base}:tags:option:b`);
    expect(message).not.toContain(`${base}:status:option:open`);
    expect(message).not.toContain(":lines:");
  });

  test("a missing embedded cell option key is reported", () => {
    const present = ALL_KEYS.filter((k) => !k.endsWith(":cell:kind:option:service"));
    expect(() => validateFieldValueTranslations([shopWith(present)], true)).toThrow(
      /lines:cell:kind:option:service/,
    );
  });
});
