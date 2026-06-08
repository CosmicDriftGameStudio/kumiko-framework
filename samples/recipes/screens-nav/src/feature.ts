// Screens + Nav Showcase — two features prove:
//   1. All three screen variants (entityList, entityEdit, custom) register
//      through r.screen()
//   2. Field-level conditionals (visible/readOnly/required) use typed
//      FieldCondition<TData> so feature authors get narrowed access to
//      the form row and the user context without any `as`-casts
//   3. Level-4 slots + Level-2 renderers are plain-data shapes — engine
//      stores them verbatim, ui-core resolves at mount-time
//   4. r.nav() flattens into a registry-wide tree whose parent refs can
//      cross feature boundaries (bookshop-admin hangs a nav under
//      bookshop's main group — no import, no coupling)
//
// The rendering is ui-core's job (M1 Phase 4/5); this sample focuses on
// the Framework surface — registration + boot-validation + registry
// lookups the renderer will consume.

import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  type FeatureDefinition,
  type FieldCondition,
} from "@cosmicdrift/kumiko-framework/engine";

export const bookEntity = createEntity({
  table: "read_books",
  fields: {
    title: createTextField({ required: true, maxLength: 200 }),
    author: createTextField({ required: true, maxLength: 100 }),
    price: createNumberField({ required: true }),
    published: createBooleanField({ default: false }),
  },
});

type BookRow = {
  readonly title: string;
  readonly author: string;
  readonly price: number;
  readonly published: boolean;
};

type FormCtx = {
  readonly user?: { readonly roles: readonly string[] };
};

// Typed FieldCondition — `data` is BookRow, `ctx.user.roles` is available.
// Feature author gets completions at every dot-access; no `as`-casts needed
// at call sites. The framework treats these functions as opaque; TS carries
// the narrowing through to wherever ui-core evaluates them.
const priceReadOnlyWhenPublished: FieldCondition<BookRow, FormCtx> = (data, ctx) => {
  // Admins can always edit the price. Non-admins can only edit it before
  // the book is published.
  if (ctx.user?.roles.includes("Admin")) return false;
  return data.published === true;
};

const authorVisibleOnlyToAdmin: FieldCondition<BookRow, FormCtx> = (_data, ctx) =>
  ctx.user?.roles.includes("Admin") ?? false;

export function createBookshopFeature(): FeatureDefinition {
  return defineFeature("bookshop", (r) => {
    r.systemScope();
    r.entity("book", bookEntity);

    // entityList — columns carry string shorthand and the object form
    // side by side; the framework normalizes both through
    // normalizeListColumn() at ui-core's iteration time.
    r.screen({
      id: "book-list",
      type: "entityList",
      entity: "book",
      columns: [
        "title",
        "author",
        {
          field: "price",
          renderer: { format: "currency", symbol: "€" },
        },
        "published",
      ],
    });

    // entityEdit — sections + spans + conditionals + slots.
    r.screen({
      id: "book-edit",
      type: "entityEdit",
      entity: "book",
      layout: {
        sections: [
          {
            title: "bookshop:section.basics",
            columns: 2,
            fields: ["title", { field: "author", visible: authorVisibleOnlyToAdmin }],
          },
          {
            title: "bookshop:section.publishing",
            columns: 2,
            fields: [
              {
                field: "price",
                readOnly: priceReadOnlyWhenPublished,
                // Spans on the section's column-grid: price takes 1
                // column, the boolean below takes 1.
                span: 1,
              },
              { field: "published", span: 1 },
            ],
          },
        ],
      },
      slots: {
        // Opaque to the engine — ui-core resolves the platform at mount.
        // The shape { react, native } is the PlatformComponent contract.
        afterForm: { react: { __component: "BookHistorySidebar" } },
      },
      access: { roles: ["Admin", "Editor"] },
    });

    // Top-level nav group — no screen attached (pure container). Children
    // come from this feature AND from bookshop-admin below.
    r.nav({
      id: "main",
      label: "bookshop:nav.main",
      icon: "book-open",
      order: 10,
    });
    r.nav({
      id: "books",
      label: "bookshop:nav.books",
      parent: "bookshop:nav:main",
      screen: "bookshop:screen:book-list",
      order: 10,
    });
  });
}

export function createBookshopAdminFeature(): FeatureDefinition {
  return defineFeature("bookshop-admin", (r) => {
    r.systemScope();

    // Custom screen — no entity, renderer is opaque. `renderer` is a
    // PlatformComponent; react OR native must be set (boot-validator
    // enforces this).
    r.screen({
      id: "audit-log",
      type: "custom",
      renderer: { react: { __component: "AuditLogScreen" } },
      access: { roles: ["Admin"] },
    });

    // Cross-feature nav parent — `bookshop:nav:main` lives in the other
    // feature. Both boot-validator refs (screen + parent) + the cycle
    // check resolve across all registered features.
    r.nav({
      id: "audit",
      label: "bookshop-admin:nav.audit",
      parent: "bookshop:nav:main",
      screen: "bookshop-admin:screen:audit-log",
      access: { roles: ["Admin"] },
      order: 20,
    });
  });
}
