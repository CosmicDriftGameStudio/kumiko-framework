// Screens + Nav Showcase — Unit Test (no DB / HTTP needed).
// Proves the Framework surface that M1's ui-core Phase 4 + Phase 5 consume:
//   - registry exposes screens + navs with qualified ids
//   - cross-feature nav parents resolve
//   - convenience indexes (getScreensByEntity / getTopLevelNavs /
//     getNavsByParent) enable zero-reverse-index tree walks
//   - FieldCondition<TData, TCtx> lands typed on the stored EditFieldSpec
//   - normalizeEditField / normalizeListColumn collapse the string shorthand
//   - validateBoot catches the common author mistakes (unknown field,
//     custom screen without a renderer component)

import {
  createRegistry,
  defineFeature,
  normalizeEditField,
  normalizeListColumn,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { describe, expect, test } from "vitest";
import { bookEntity, createBookshopAdminFeature, createBookshopFeature } from "../feature";

const bookshop = createBookshopFeature();
const bookshopAdmin = createBookshopAdminFeature();
const registry = createRegistry([bookshop, bookshopAdmin]);

describe("screens-nav showcase — registry state", () => {
  test("validateBoot accepts the full registered app", () => {
    expect(() => validateBoot([bookshop, bookshopAdmin])).not.toThrow();
  });

  test("all three screen variants registered with qualified ids", () => {
    expect(registry.getScreen("bookshop:screen:book-list")?.id).toBe("bookshop:screen:book-list");
    expect(registry.getScreen("bookshop:screen:book-edit")?.id).toBe("bookshop:screen:book-edit");
    expect(registry.getScreen("bookshop-admin:screen:audit-log")?.id).toBe(
      "bookshop-admin:screen:audit-log",
    );
  });

  test("getScreensByEntity indexes entityList + entityEdit, excludes custom", () => {
    const byBook = registry.getScreensByEntity("book");
    expect(byBook.map((s) => s.id).sort()).toEqual([
      "bookshop:screen:book-edit",
      "bookshop:screen:book-list",
    ]);
    // Custom screens (no entity) are never indexed here.
    for (const s of byBook) expect(s.type).not.toBe("custom");
  });
});

describe("screens-nav showcase — nav tree", () => {
  test("getTopLevelNavs returns only parent-less entries, qualified id", () => {
    const tops = registry.getTopLevelNavs();
    expect(tops.map((n) => n.id)).toEqual(["bookshop:nav:main"]);
  });

  test("cross-feature nav parent: bookshop-admin hangs under bookshop:nav:main", () => {
    const children = registry.getNavsByParent("bookshop:nav:main");
    // Two direct children — one from bookshop, one from bookshop-admin.
    // The registry preserves registration order (bookshop first, admin
    // second), so that's how they come back; the renderer sorts by `order`
    // at tree-assembly time.
    expect(children.map((n) => n.id)).toEqual(["bookshop:nav:books", "bookshop-admin:nav:audit"]);
  });

  test("nav entries preserve screen/access/icon/order from the declaration", () => {
    const books = registry.getNav("bookshop:nav:books");
    expect(books).toMatchObject({
      label: "bookshop:nav.books",
      parent: "bookshop:nav:main",
      screen: "bookshop:screen:book-list",
      order: 10,
    });
    const audit = registry.getNav("bookshop-admin:nav:audit");
    expect(audit?.access).toEqual({ roles: ["Admin"] });
  });

  test("feature.navs (unregistered) keeps the short id side-by-side with the qualified registry-side", () => {
    // Same NavDefinition — different perspective. feature-author-side uses
    // short ids (stable across feature-renames via auto-prefix), the
    // registry mutates `id` to qualified for downstream consumers.
    expect(bookshop.navs["main"]?.id).toBe("main");
    expect(registry.getNav("bookshop:nav:main")?.id).toBe("bookshop:nav:main");
  });
});

describe("screens-nav showcase — field specs", () => {
  test("normalizeEditField collapses string shorthand into the object form", () => {
    // String form: just a field reference — downstream consumers treat
    // it the same as the full object with no overrides.
    expect(normalizeEditField("title")).toEqual({ field: "title" });
    // Object form is returned verbatim.
    const condition = () => true;
    expect(normalizeEditField({ field: "price", readOnly: condition, span: 1 })).toEqual({
      field: "price",
      readOnly: condition,
      span: 1,
    });
  });

  test("normalizeListColumn collapses string columns too", () => {
    expect(normalizeListColumn("author")).toEqual({ field: "author" });
    const fmt = (v: unknown) => String(v);
    expect(normalizeListColumn({ field: "price", renderer: fmt })).toEqual({
      field: "price",
      renderer: fmt,
    });
  });

  test("FieldCondition functions survive registry storage intact", () => {
    // The engine treats conditions as opaque values; ui-core evaluates
    // them at render time. We verify the function reference round-trips
    // and its typed call signature still works.
    const screen = registry.getScreen("bookshop:screen:book-edit");
    if (screen?.type !== "entityEdit") throw new Error("expected entityEdit");
    const priceField = normalizeEditField(screen.layout.sections[1]!.fields[0]!);
    expect(typeof priceField.readOnly).toBe("function");
    // Simulate a call with narrowed data / ctx — Admin bypass + published gate.
    const adminCtx = { user: { roles: ["Admin"] as const } };
    const readerCtx = { user: { roles: ["Reader"] as const } };
    const publishedBook = { title: "t", author: "a", price: 9.99, published: true };
    const draftBook = { ...publishedBook, published: false };
    expect(priceField.readOnly?.(publishedBook, adminCtx)).toBe(false);
    expect(priceField.readOnly?.(publishedBook, readerCtx)).toBe(true);
    expect(priceField.readOnly?.(draftBook, readerCtx)).toBe(false);
  });
});

describe("screens-nav showcase — boot-validator catches author mistakes", () => {
  test("unknown field in entityEdit section fails boot with a useful message", () => {
    // Typo-protection: field refs must exist on the entity. Mis-spelled
    // column names would otherwise silently vanish from the form.
    const broken = defineFeature("broken-shop", (r) => {
      r.entity("book", bookEntity);
      r.screen({
        id: "book-edit",
        type: "entityEdit",
        entity: "book",
        layout: {
          sections: [
            { title: "s", fields: ["title", "tittle"] }, // typo
          ],
        },
      });
    });
    expect(() => validateBoot([broken])).toThrow(/field "tittle"/);
  });

  test("custom screen needs at least one platform renderer", () => {
    // A custom screen with an empty renderer object is structurally empty
    // — ui-core would have nothing to mount. Caught at boot.
    const broken = defineFeature("empty-custom", (r) => {
      r.screen({ id: "blank", type: "custom", renderer: {} });
    });
    expect(() => validateBoot([broken])).toThrow(/react nor a native component/);
  });

  test("nav with dangling screen ref fails boot", () => {
    const broken = defineFeature("ghost-ref", (r) => {
      r.nav({ id: "lost", label: "x", screen: "does-not:screen:exist" });
    });
    expect(() => validateBoot([broken])).toThrow(/references screen "does-not:screen:exist"/);
  });
});
