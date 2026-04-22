import { describe, expect, test } from "vitest";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";
import { createRegistry } from "../registry";
import type { ScreenDefinition } from "../types/screen";

function productEntity() {
  return createEntity({
    table: "products",
    fields: {
      name: createTextField(),
      sku: createTextField(),
    },
  });
}

describe("r.screen() — registration", () => {
  test("stores an entityList screen on the FeatureDefinition", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name", "sku"],
      });
    });
    expect(feature.screens["product-list"]).toBeDefined();
    expect(feature.screens["product-list"]?.type).toBe("entityList");
  });

  test("stores an entityEdit screen with sections + conditional fields", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [
            {
              title: "shop:section.basics",
              columns: 2,
              fields: [
                "name",
                { field: "sku", readonly: (data) => Boolean((data as { sku?: string }).sku) },
              ],
            },
          ],
        },
      });
    });
    const screen = feature.screens["product-edit"];
    expect(screen?.type).toBe("entityEdit");
    if (screen?.type !== "entityEdit") throw new Error("type-narrow failed");
    expect(screen.layout.sections).toHaveLength(1);
  });

  test("stores a custom screen with a renderer + routes", () => {
    const feature = defineFeature("dashboard", (r) => {
      r.screen({
        id: "overview",
        type: "custom",
        renderer: { react: { __component: "dashboard-overview" } },
        routes: [{ path: "/revenue", component: { react: { __component: "revenue" } } }],
      });
    });
    const screen = feature.screens["overview"];
    expect(screen?.type).toBe("custom");
    if (screen?.type !== "custom") throw new Error("type-narrow failed");
    expect(screen.routes).toHaveLength(1);
  });

  test("rejects duplicate screen ids within the same feature", () => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.entity("product", productEntity());
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
        });
        r.screen({
          id: "product-list",
          type: "entityEdit",
          entity: "product",
          layout: { sections: [] },
        });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects non-kebab-case screen ids", () => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.entity("product", productEntity());
        r.screen({
          id: "productList",
          type: "entityList",
          entity: "product",
          columns: ["name"],
        });
      }),
    ).toThrow(/kebab-case/);
  });

  test("accepts kebab-case screen ids", () => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.entity("product", productEntity());
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
        });
      }),
    ).not.toThrow();
  });
});

describe("createRegistry — screen indexing", () => {
  test("indexes screens by qualified name", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
    });
    const registry = createRegistry([feature]);
    expect(registry.getAllScreens().size).toBe(1);
    expect(registry.getScreen("shop:screen:product-list")).toBeDefined();
  });

  test("returns undefined for unknown qualified names", () => {
    const registry = createRegistry([]);
    expect(registry.getScreen("ghost:screen:nope")).toBeUndefined();
  });

  test("getScreenFeature maps a screen back to its owning feature", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
    });
    const registry = createRegistry([feature]);
    expect(registry.getScreenFeature("shop:screen:product-list")).toBe("shop");
    expect(registry.getScreenFeature("shop:screen:does-not-exist")).toBeUndefined();
  });

  test("same screen id from two features qualifies to different names", () => {
    const shop = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
    });
    const warehouse = defineFeature("warehouse", (r) => {
      r.entity("item", productEntity());
      r.screen({ id: "list", type: "entityList", entity: "item", columns: ["name"] });
    });
    const registry = createRegistry([shop, warehouse]);
    expect(registry.getAllScreens().size).toBe(2);
    expect(registry.getScreen("shop:screen:list")).toBeDefined();
    expect(registry.getScreen("warehouse:screen:list")).toBeDefined();
  });
});

describe("validateBoot — screen validation", () => {
  test("entityList with unknown entity fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "list",
        type: "entityList",
        entity: "ghost",
        columns: ["name"],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/references entity "ghost"/);
  });

  test("cross-feature entity-ref hint points at the real owner", () => {
    // Entity exists, but in another feature. The hint helps the feature
    // author realise cross-feature screen ownership isn't supported.
    const shop = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
    });
    const ui = defineFeature("ui", (r) => {
      r.screen({ id: "list", type: "entityList", entity: "product", columns: ["name"] });
    });
    expect(() => validateBoot([shop, ui])).toThrow(/owned by feature "shop"/);
  });

  test("entityList with unknown field (string form) fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "list",
        type: "entityList",
        entity: "product",
        columns: ["name", "mistake"],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/field "mistake"/);
  });

  test("entityList with unknown field (object form) fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "list",
        type: "entityList",
        entity: "product",
        columns: [{ field: "nonexistent" }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/field "nonexistent"/);
  });

  test("entityEdit with unknown field (string form in sections) fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [{ title: "s", fields: ["name", "oops"] }],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/field "oops"/);
  });

  test("entityEdit with unknown field (object form in sections) fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [{ title: "s", fields: [{ field: "ghost" }] }],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/field "ghost"/);
  });

  test("custom screen without a renderer-component (neither react nor native) fails", () => {
    const feature = defineFeature("dashboard", (r) => {
      const screen: ScreenDefinition = {
        id: "empty",
        type: "custom",
        renderer: {},
      };
      r.screen(screen);
    });
    expect(() => validateBoot([feature])).toThrow(/neither a react nor a native component/);
  });

  test("custom screen with just react passes", () => {
    const feature = defineFeature("dashboard", (r) => {
      r.screen({
        id: "ok",
        type: "custom",
        renderer: { react: { __component: true } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("custom screen with just native passes (mobile-only feature)", () => {
    const feature = defineFeature("dashboard", (r) => {
      r.screen({
        id: "ok",
        type: "custom",
        renderer: { native: { __component: true } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("fully-populated entityEdit with sections + slots + conditionals passes boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [
            {
              title: "shop:section.basics",
              columns: 2,
              fields: [
                "name",
                { field: "sku", visible: () => true, required: () => true },
              ],
            },
          ],
        },
        slots: { header: { react: { __component: "h" } } },
        access: { roles: ["Admin"] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
