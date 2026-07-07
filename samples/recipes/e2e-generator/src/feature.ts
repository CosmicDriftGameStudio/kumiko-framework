import {
  createBooleanField,
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
  type FeatureDefinition,
  registerEntityCrud,
} from "@cosmicdrift/kumiko-framework/engine";

export const productEntity = createEntity({
  table: "read_products",
  fields: {
    name: createTextField({ required: true, maxLength: 200 }),
    description: createTextField({ maxLength: 2000, allowPlaintext: "is-business-data" }),
    price: createNumberField({ required: true }),
    status: createSelectField({ options: ["draft", "published", "archived"] as const }),
    featured: createBooleanField({ default: false }),
    listPrice: createMoneyField({}),
  },
});

const editorWrite = { access: { roles: ["Admin", "Editor"] } } as const;

export function createShopFeature(): FeatureDefinition {
  return defineFeature("shop", (r) => {
    r.systemScope();
    registerEntityCrud(r, "product", productEntity, {
      write: editorWrite,
      verbs: { list: false, detail: false, restore: false },
    });

    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: [
        "name",
        { field: "price", renderer: { format: "currency", symbol: "€" } },
        "status",
        "featured",
      ],
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
