import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

describe("validateBoot — i18n surface keys", () => {
  test("passes when screen-derived keys are in r.translations", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: { name: createTextField({ sortable: true }) },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("throws when screen title key is missing", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: { name: createTextField({ sortable: true }) },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
      r.translations({
        keys: {
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /required translation key missing: "screen:item-list.title"/,
    );
  });

  test("throws when feature has screens but no r.translations", () => {
    const feature = defineFeature("legacy", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: { name: createTextField({ sortable: true }) },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/required translation key missing/);
  });

  test("throws when de/en locale is missing", () => {
    const feature = defineFeature("demo", (r) => {
      r.nav({ id: "home", label: "demo:nav.home" });
      r.translations({
        keys: {
          "demo:nav.home": { de: "Start", en: "" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/missing locale\(s\): en/);
  });
});
