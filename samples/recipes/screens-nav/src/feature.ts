// Screens + Nav Showcase — two features prove:
//   1. All three screen variants (entityList, entityEdit, custom) register
//      through r.screen()
//   2. Field-level conditionals (visible/readOnly/required) use declarative
//      FieldCondition ({ field, eq/ne } | boolean) — JSON-safe for schema
//      injection and ui-core evaluation at render time
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

    // entityEdit — sections + spans + declarative conditionals + slots.
    r.screen({
      id: "book-edit",
      type: "entityEdit",
      entity: "book",
      layout: {
        sections: [
          {
            title: "bookshop:section.basics",
            columns: 2,
            fields: ["title", { field: "author", visible: { field: "published", eq: false } }],
          },
          {
            title: "bookshop:section.publishing",
            columns: 2,
            fields: [
              {
                field: "price",
                readOnly: { field: "published", eq: true },
                span: 1,
              },
              { field: "published", span: 1 },
            ],
          },
        ],
      },
      slots: {
        afterForm: { react: { __component: "BookHistorySidebar" } },
      },
      access: { roles: ["Admin", "Editor"] },
    });

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

    r.screen({
      id: "audit-log",
      type: "custom",
      renderer: { react: { __component: "AuditLogScreen" } },
      access: { roles: ["Admin"] },
    });

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
