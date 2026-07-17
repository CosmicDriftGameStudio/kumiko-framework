import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createDerivedField, createEntity, createTextField } from "../factories";
import { createRegistry } from "../registry";
import type { ScreenDefinition } from "../types/screen";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function productEntity() {
  return createEntity({
    table: "products",
    fields: {
      name: createTextField(),
      sku: createTextField(),
    },
  });
}

function derivedProductEntity() {
  return createEntity({
    table: "derived_products",
    fields: {
      name: createTextField(),
    },
    derivedFields: {
      summary: createDerivedField({
        valueType: "text",
        derive: (row) => String(row["name"]),
      }),
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

  test("stores a projectionList screen bound to an explicit (cross-feature) query", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: [
          { field: "description", label: "app:col.desc" },
          {
            field: "amount",
            label: "app:col.amount",
            renderer: { react: { __component: "EuroCell" } },
          },
        ],
      });
    });
    const screen = feature.screens["rent-list"];
    expect(screen?.type).toBe("projectionList");
    if (screen?.type !== "projectionList") throw new Error("type-narrow failed");
    expect(screen.query).toBe("ledger:query:schedule:list");
  });

  test("validateBoot rejects a projectionList with empty columns", () => {
    const features = [
      defineFeature("app", (r) => {
        r.screen({ id: "x", type: "projectionList", query: "app:query:foo:list", columns: [] });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/empty columns list/i);
  });

  test("validateBoot rejects a projectionList with an empty query", () => {
    const features = [
      defineFeature("app", (r) => {
        r.screen({ id: "x", type: "projectionList", query: "", columns: ["name"] });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/empty or non-string query/i);
  });

  test("stores a projectionDetail screen bound to an explicit query", () => {
    const feature = defineFeature("app", (r) => {
      r.screen({
        id: "rent-detail",
        type: "projectionDetail",
        query: "ledger:query:schedule:detail",
        layout: { sections: [{ title: "app:section.basics", fields: ["description"] }] },
      });
    });
    const screen = feature.screens["rent-detail"];
    expect(screen?.type).toBe("projectionDetail");
    if (screen?.type !== "projectionDetail") throw new Error("type-narrow failed");
    expect(screen.query).toBe("ledger:query:schedule:detail");
  });

  test("validateBoot rejects a projectionDetail with an empty query", () => {
    const features = [
      defineFeature("app", (r) => {
        r.screen({
          id: "x",
          type: "projectionDetail",
          query: "",
          layout: { sections: [{ title: "s", fields: ["name"] }] },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/empty or non-string query/i);
  });

  test("validateBoot rejects a projectionDetail with empty sections", () => {
    const features = [
      defineFeature("app", (r) => {
        r.screen({
          id: "x",
          type: "projectionDetail",
          query: "app:query:foo:detail",
          layout: { sections: [] },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/empty sections list/i);
  });

  test("validateBoot rejects a projectionDetail section with zero fields", () => {
    const features = [
      defineFeature("app", (r) => {
        r.screen({
          id: "x",
          type: "projectionDetail",
          query: "app:query:foo:detail",
          layout: { sections: [{ title: "s", fields: [] }] },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/zero fields/i);
  });

  test("validateBoot rejects a projectionDetail with an extension section (no entity to persist against)", () => {
    const features = [
      defineFeature("app", (r) => {
        r.screen({
          id: "x",
          type: "projectionDetail",
          query: "app:query:foo:detail",
          layout: {
            sections: [
              { kind: "extension", title: "s", component: { react: { __component: "c" } } },
            ],
          },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/extension section/i);
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
              fields: ["name", { field: "sku", readOnly: { field: "sku", ne: null } }],
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

  test("getScreensByEntity groups entity-bound screens", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ title: "t", fields: ["name"] }] },
      });
      // custom screens have no entity; they must not show up in the index.
      r.screen({ id: "overview", type: "custom", renderer: { react: { __c: true } } });
    });
    const registry = createRegistry([feature]);
    const byProduct = registry.getScreensByEntity("product");
    expect(byProduct).toHaveLength(2);
    // Stored screens carry the qualified id — same contract as
    // getScreen(qn).id / getAllScreens() values. Saves ui-core the reverse
    // index when recursing through slots / field renderers by QN.
    expect(byProduct.map((s) => s.id).sort()).toEqual([
      "shop:screen:product-edit",
      "shop:screen:product-list",
    ]);
  });

  test("getScreensByEntity aggregates screens on the same entity from two different features", () => {
    const shop = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
    });
    const reporting = defineFeature("reporting", (r) => {
      r.screen({
        id: "product-stats",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
    });
    const registry = createRegistry([shop, reporting]);
    const byProduct = registry.getScreensByEntity("product");
    expect(byProduct.map((s) => s.id).sort()).toEqual([
      "reporting:screen:product-stats",
      "shop:screen:product-list",
    ]);
  });

  test("getScreen / getScreensByEntity return stored screens with qualified id", () => {
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
    // Input-side (unregistered FeatureDefinition) keeps the short form.
    expect(feature.screens["product-list"]?.id).toBe("product-list");
    // Registry-side always exposes the qualified form.
    expect(registry.getScreen("shop:screen:product-list")?.id).toBe("shop:screen:product-list");
  });

  test("getScreensByEntity returns empty for unknown entities", () => {
    const registry = createRegistry([]);
    expect(registry.getScreensByEntity("ghost")).toHaveLength(0);
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

  test("entityList with a derived-field column boots (derived is a valid column)", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", derivedProductEntity());
      r.screen({
        id: "list",
        type: "entityList",
        entity: "product",
        columns: ["name", "summary"],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("entityList defaultSort on a derived field fails boot (server sort can't apply)", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", derivedProductEntity());
      r.screen({
        id: "list",
        type: "entityList",
        entity: "product",
        columns: ["name", "summary"],
        defaultSort: { field: "summary", dir: "asc" },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/defaultSort references unknown field "summary"/);
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
              fields: ["name", { field: "sku", visible: true, required: true }],
            },
          ],
        },
        slots: { header: { react: { __component: "h" } } },
        access: { roles: ["Admin"] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("entityList with empty columns fails boot", () => {
    // Blank columns list renders as a blank table — almost always an author
    // oversight. Locked down at boot rather than silently producing an empty
    // UI surface.
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({ id: "list", type: "entityList", entity: "product", columns: [] });
    });
    expect(() => validateBoot([feature])).toThrow(/empty columns list/);
  });

  test("entityEdit with empty sections fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/empty sections list/);
  });

  test("entityEdit with a section that has zero fields fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ title: "shop:section.empty", fields: [] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/zero fields/);
  });
});
