import { describe, expect, test } from "bun:test";
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
    expect(feature.navs["catalog"]).toBeDefined();
    expect(feature.navs["catalog"]?.label).toBe("shop:nav.catalog");
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
    const nav = feature.navs["products"];
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
    expect(registry.getAllNavs().size).toBe(1);
    expect(registry.getNav("shop:nav:catalog")).toBeDefined();
  });

  test("returns undefined for unknown qualified nav names", () => {
    const registry = createRegistry([]);
    expect(registry.getNav("ghost:nav:nope")).toBeUndefined();
  });

  test("getNavFeature maps a nav entry back to its owning feature", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "catalog", label: "x" });
    });
    const registry = createRegistry([feature]);
    expect(registry.getNavFeature("shop:nav:catalog")).toBe("shop");
    expect(registry.getNavFeature("shop:nav:nope")).toBeUndefined();
  });

  test("same nav id from two features qualifies to different names", () => {
    const shop = defineFeature("shop", (r) => {
      r.nav({ id: "home", label: "x" });
    });
    const settings = defineFeature("settings", (r) => {
      r.nav({ id: "home", label: "y" });
    });
    const registry = createRegistry([shop, settings]);
    expect(registry.getAllNavs().size).toBe(2);
    expect(registry.getNav("shop:nav:home")).toBeDefined();
    expect(registry.getNav("settings:nav:home")).toBeDefined();
  });

  test("getTopLevelNavs + getNavsByParent partition the tree cleanly", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "root", label: "r" });
      r.nav({ id: "mid", label: "m", parent: "shop:nav:root" });
      r.nav({ id: "leaf-a", label: "a", parent: "shop:nav:mid" });
      r.nav({ id: "leaf-b", label: "b", parent: "shop:nav:mid" });
      r.nav({ id: "other-root", label: "r2" });
    });
    const registry = createRegistry([feature]);

    // Two top-level entries (root + other-root), registration order preserved.
    // Stored ids are qualified — caller can feed them straight back into
    // getNavsByParent without a reverse index.
    const tops = registry.getTopLevelNavs();
    expect(tops.map((n) => n.id)).toEqual(["shop:nav:root", "shop:nav:other-root"]);

    // Direct children of root (just `mid`).
    const rootChildren = registry.getNavsByParent("shop:nav:root");
    expect(rootChildren.map((n) => n.id)).toEqual(["shop:nav:mid"]);

    // Direct children of mid (leaf-a + leaf-b, order preserved).
    const midChildren = registry.getNavsByParent("shop:nav:mid");
    expect(midChildren.map((n) => n.id)).toEqual(["shop:nav:leaf-a", "shop:nav:leaf-b"]);

    // Unknown parent → empty.
    expect(registry.getNavsByParent("ghost:nav:nope")).toHaveLength(0);
  });

  test("getNavsByParent aggregates cross-feature children under a shared parent", () => {
    const shell = defineFeature("shell", (r) => {
      r.nav({ id: "main", label: "x" });
    });
    const shop = defineFeature("shop", (r) => {
      r.nav({ id: "catalog", label: "y", parent: "shell:nav:main" });
    });
    const settings = defineFeature("settings", (r) => {
      r.nav({ id: "general", label: "z", parent: "shell:nav:main" });
    });
    const registry = createRegistry([shell, shop, settings]);
    const children = registry.getNavsByParent("shell:nav:main");
    expect(children.map((n) => n.id).sort()).toEqual(["settings:nav:general", "shop:nav:catalog"]);
  });

  test("getNav / getAllNavs / getTopLevelNavs return stored navs with qualified id", () => {
    const feature = defineFeature("shop", (r) => {
      r.nav({ id: "catalog", label: "x" });
    });
    const registry = createRegistry([feature]);
    // Input-side keeps the short id; only registry-side exposes qualified.
    expect(feature.navs["catalog"]?.id).toBe("catalog");
    expect(registry.getNav("shop:nav:catalog")?.id).toBe("shop:nav:catalog");
    expect(registry.getTopLevelNavs()[0]?.id).toBe("shop:nav:catalog");
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
