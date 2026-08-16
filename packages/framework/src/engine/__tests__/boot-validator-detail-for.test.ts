import { describe, expect, test } from "bun:test";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

describe("validateBoot — detailFor screens (fw#2163)", () => {
  test("two screens with the same detailFor fail boot, naming both screen ids", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      r.screen({
        id: "item-detail-a",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "item",
      });
      r.screen({
        id: "item-detail-b",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "item",
      });
      r.translations({
        keys: {
          "screen:item-detail-a.title": { de: "A", en: "A" },
          "screen:item-detail-b.title": { de: "B", en: "B" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/detailFor: "item"/);
    expect(() => validateBoot([feature])).toThrow(/demo:screen:item-detail-a/);
    expect(() => validateBoot([feature])).toThrow(/demo:screen:item-detail-b/);
  });

  test("detailFor on an unknown entity fails boot", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      r.screen({
        id: "item-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "ghost",
      });
      r.translations({
        keys: {
          "screen:item-detail.title": { de: "Detail", en: "Detail" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/"ghost"/);
  });

  test("a valid detailFor on a custom screen passes boot", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      r.screen({
        id: "item-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "item",
      });
      r.translations({
        keys: {
          "screen:item-detail.title": { de: "Detail", en: "Detail" },
          "demo:entity:item:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("an entity without any detail screen passes boot", () => {
    const feature = defineFeature("demo", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      r.translations({
        keys: { "demo:entity:item:field:name": { de: "Name", en: "Name" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
