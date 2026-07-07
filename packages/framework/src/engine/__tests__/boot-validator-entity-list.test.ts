import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

describe("validateBoot — entityList screens", () => {
  test("requires defaultSort when searchable", () => {
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
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
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
      r.entity("attempt", createEntity({ table: "Attempts", fields: { id: createTextField() } }));
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
});
