import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";

describe("validateBoot — entityList screens", () => {
  test("requires defaultSort when searchable", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/defaultSort required/);
  });

  test("rejects searchable:false on operator lists not on whitelist", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        searchable: false,
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/searchable defaults to true/);
  });

  test("allows searchable:false on download-attempt-list whitelist", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "attempt",
        createEntity({
          table: "Attempts",
          fields: { id: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "download-attempt-list",
        type: "entityList",
        entity: "attempt",
        columns: ["id"],
        searchable: false,
      });
      r.translations({
        keys: {
          "screen:download-attempt-list.title": { de: "Liste", en: "List" },
          "demo:entity:attempt:field:id": { de: "ID", en: "ID" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("requires navigate rowAction when entityEdit exists", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
      });
      r.screen({
        id: "item-edit",
        type: "entityEdit",
        entity: "item",
        layout: { sections: [{ fields: ["name"] }] },
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "screen:item-edit.title": { de: "Edit", en: "Edit" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/navigate rowAction/);
  });

  function featureWithCreateScreen(createScreen: string) {
    return defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
        createScreen,
        rowActions: [{ kind: "navigate", id: "edit", label: "Edit", screen: "item-edit" }],
      });
      r.screen({
        id: "item-edit",
        type: "entityEdit",
        entity: "item",
        layout: { sections: [{ fields: ["name"] }] },
      });
      r.translations({
        keys: {
          "screen:item-list.title": { de: "Liste", en: "List" },
          "screen:item-edit.title": { de: "Edit", en: "Edit" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
  }

  test("createScreen naming an unknown screen fails boot", () => {
    expect(() => validateBoot([featureWithCreateScreen("ghost-edit")])).toThrow(
      /createScreen "ghost-edit" does not resolve/,
    );
  });

  test("createScreen naming a screen of the same feature passes boot", () => {
    expect(() => validateBoot([featureWithCreateScreen("item-edit")])).not.toThrow();
  });
});

describe("validateBoot — entityEdit recordTitleField", () => {
  function featureWithRecordTitleField(recordTitleField: string) {
    return defineFeature("demo", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "item-edit",
        type: "entityEdit",
        entity: "item",
        recordTitleField,
        layout: { sections: [{ fields: ["name"] }] },
      });
      r.translations({
        keys: {
          "screen:item-edit.title": { de: "Edit", en: "Edit" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
  }

  test("a field that is not on the entity fails boot", () => {
    expect(() => validateBoot([featureWithRecordTitleField("title")])).toThrow(
      /recordTitleField "title" is not a field of entity "item"/,
    );
  });

  test("an entity field passes boot", () => {
    expect(() => validateBoot([featureWithRecordTitleField("name")])).not.toThrow();
  });
});
