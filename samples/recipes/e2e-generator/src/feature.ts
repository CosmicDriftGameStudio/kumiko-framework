// E2E-Generator Sample — Shop/Product Feature.
//
// Zeigt die Feldtyp-Bandbreite die der Generator heute abdeckt, plus einen
// bewusst ausgelassenen Fall (money + image) den er korrekt skippt.
//
// Im begleitenden Test wird dieses Feature an generateE2ESpec übergeben
// und die vier Test-Kinds (list-renders, list-has-fixture-row,
// edit-validates-required, edit-save-persists) werden als Snapshot
// eingefroren. Output ist JSON-serialisierbares E2ETestSpec[] — der Test
// dokumentiert die Konvention, dieses JSON auf Platte zu schreiben und
// vom externen Playwright-Worker konsumieren zu lassen.

import {
  createBooleanField,
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

export const productEntity = createEntity({
  table: "read_products",
  fields: {
    // text required → .fill() + erscheint als Identifying-Value in der Liste
    name: createTextField({ required: true, maxLength: 200 }),
    // text optional → .fill(), kein Validation-Check
    description: createTextField({ maxLength: 2000, allowPlaintext: "is-business-data" }),
    // number → .fill() mit String("1")
    price: createNumberField({ required: true }),
    // select → .selectOption(erste Option), NICHT .fill() (Bug-Falle!)
    status: createSelectField({ options: ["draft", "published", "archived"] as const }),
    // boolean → .setChecked(true)
    featured: createBooleanField({ default: false }),
    // money → kein generischer Form-Widget-Zugriff, aber Object-Fixture
    // ({ amount, currency }) wird fürs API-Seed geliefert. Zeigt den Split
    // zwischen API-Fixture (vollständig) und Form-Interaktion (reduziert).
    listPrice: createMoneyField({}),
  },
});

const editorWrite = { access: { roles: ["Admin", "Editor"] } } as const;

export function createShopFeature(): FeatureDefinition {
  return defineFeature("shop", (r) => {
    r.systemScope();
    r.entity("product", productEntity);

    // Create-Handler ist Pflicht für list-has-fixture-row + edit-save-persists.
    // Ohne Handler skippt der Generator sauber — siehe Sample-Test.
    r.writeHandler(defineEntityCreateHandler("product", productEntity, editorWrite));
    r.writeHandler(defineEntityUpdateHandler("product", productEntity, editorWrite));
    r.writeHandler(defineEntityDeleteHandler("product", productEntity, editorWrite));

    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name", { field: "price", renderer: { format: "currency", symbol: "€" } }, "status", "featured"],
    });

    r.screen({
      id: "product-edit",
      type: "entityEdit",
      entity: "product",
      layout: {
        sections: [
          {
            title: "shop:section.basics",
            columns: 2,
            fields: ["name", { field: "description", span: 2 }],
          },
          {
            title: "shop:section.publishing",
            columns: 2,
            fields: ["price", "status", "featured"],
          },
          {
            title: "shop:section.pricing",
            fields: ["listPrice"],
          },
        ],
      },
    });

    r.nav({
      id: "products",
      label: "shop:nav.products",
      icon: "package",
      screen: "shop:screen:product-list",
      order: 10,
    });
  });
}
