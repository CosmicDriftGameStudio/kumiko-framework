import { describe, expect, test } from "vitest";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";
import { createRegistry } from "../registry";

function productEntity() {
  return createEntity({
    table: "products",
    fields: { name: createTextField() },
  });
}

describe("r.nav() — registration", () => {
  test("stores a minimal nav entry", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "catalog", label: "shop:nav.catalog" });
    });
    expect(feature.navEntries["catalog"]).toBeDefined();
    expect(feature.navEntries["catalog"]?.label).toBe("shop:nav.catalog");
  });

  test("stores a nav entry with icon, order, parent, screen, access", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "products",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
      r.nav({ id: "catalog", label: "shop:nav.catalog" });
      r.nav({
        id: "products",
        label: "shop:nav.products",
        icon: "box",
        order: 10,
        parent: "shop:nav:catalog",
        screen: "shop:screen:products",
        access: { roles: ["Admin"] },
      });
    });
    const nav = feature.navEntries["products"];
    expect(nav).toMatchObject({
      icon: "box",
      order: 10,
      parent: "shop:nav:catalog",
      screen: "shop:screen:products",
    });
  });

  test("rejects duplicate nav ids within the same feature", () => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.nav({ id: "catalog", label: "a" });
        r.nav({ id: "catalog", label: "b" });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects non-kebab-case nav ids", () => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.nav({ id: "Catalog", label: "x" });
      }),
    ).toThrow(/kebab-case/);
  });

  test("accepts kebab-case nav ids", () => {
    expect(() =>
      defineFeature("shop", (r) => {
        r.nav({ id: "main-catalog", label: "x" });
      }),
    ).not.toThrow();
  });
});

describe("createRegistry — nav indexing", () => {
  test("indexes nav entries by qualified name", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "catalog", label: "x" });
    });
    const registry = createRegistry([feature]);
    expect(registry.getAllNavEntries().size).toBe(1);
    expect(registry.getNavEntry("shop:nav:catalog")).toBeDefined();
  });

  test("returns undefined for unknown qualified nav names", () => {
    const registry = createRegistry([]);
    expect(registry.getNavEntry("ghost:nav:nope")).toBeUndefined();
  });

  test("getNavEntryFeature maps a nav entry back to its owning feature", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "catalog", label: "x" });
    });
    const registry = createRegistry([feature]);
    expect(registry.getNavEntryFeature("shop:nav:catalog")).toBe("shop");
    expect(registry.getNavEntryFeature("shop:nav:nope")).toBeUndefined();
  });

  test("same nav id from two features qualifies to different names", () => {
    const shop = defineFeature("shop", (r) => {
      r.nav({ id: "home", label: "x" });
    });
    const settings = defineFeature("settings", (r) => {
      r.nav({ id: "home", label: "y" });
    });
    const registry = createRegistry([shop, settings]);
    expect(registry.getAllNavEntries().size).toBe(2);
    expect(registry.getNavEntry("shop:nav:home")).toBeDefined();
    expect(registry.getNavEntry("settings:nav:home")).toBeDefined();
  });
});

describe("validateBoot — nav validation", () => {
  test("nav referencing an unknown screen fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({
        id: "catalog",
        label: "x",
        screen: "shop:screen:does-not-exist",
      });
    });
    expect(() => validateBoot([feature])).toThrow(/references screen "shop:screen:does-not-exist"/);
  });

  test("nav referencing an unknown parent fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({
        id: "products",
        label: "x",
        parent: "shop:nav:does-not-exist",
      });
    });
    expect(() => validateBoot([feature])).toThrow(/references parent "shop:nav:does-not-exist"/);
  });

  test("nav with valid screen + parent refs passes boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "products",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
      r.nav({ id: "catalog", label: "x" });
      r.nav({
        id: "products",
        label: "y",
        parent: "shop:nav:catalog",
        screen: "shop:screen:products",
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("nav can reference a screen registered by another feature", () => {
    const shop = defineFeature("shop", (r) => {
      r.entity("product", productEntity());
      r.screen({
        id: "products",
        type: "entityList",
        entity: "product",
        columns: ["name"],
      });
    });
    const menu = defineFeature("menu", (r) => {
      r.nav({ id: "shop-entry", label: "x", screen: "shop:screen:products" });
    });
    expect(() => validateBoot([shop, menu])).not.toThrow();
  });

  test("nav can reference a parent registered by another feature", () => {
    const shell = defineFeature("shell", (r) => {
      r.nav({ id: "main", label: "x" });
    });
    const shop = defineFeature("shop", (r) => {
      r.nav({ id: "catalog", label: "y", parent: "shell:nav:main" });
    });
    expect(() => validateBoot([shell, shop])).not.toThrow();
  });

  test("direct parent cycle (a → a) fails boot", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "self", label: "x", parent: "shop:nav:self" });
    });
    expect(() => validateBoot([feature])).toThrow(/parent cycle/);
  });

  test("two-step parent cycle (a → b → a) fails boot", () => {
    // defineFeature can't close the cycle in one feature because the second
    // r.nav needs the first to already exist with the cycle-closing parent.
    // Hand-build two features whose refs point at each other.
    const a = defineFeature("a", (r) => {
      r.nav({ id: "one", label: "x", parent: "b:nav:two" });
    });
    const b = defineFeature("b", (r) => {
      r.nav({ id: "two", label: "y", parent: "a:nav:one" });
    });
    expect(() => validateBoot([a, b])).toThrow(/parent cycle/);
  });

  test("three-step parent chain without cycle passes", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "root", label: "r" });
      r.nav({ id: "mid", label: "m", parent: "shop:nav:root" });
      r.nav({ id: "leaf", label: "l", parent: "shop:nav:mid" });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
