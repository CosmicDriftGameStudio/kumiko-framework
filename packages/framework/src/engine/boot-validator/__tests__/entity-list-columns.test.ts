import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { rowMetaFieldNames } from "../../../db/table-builder.ts";
import { LIST_ROW_META_COLUMNS } from "../../../ui-types/list-row-meta.ts";
import { registerStubQueryHandler } from "../../__tests__/stub-query-handler.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { createTenantConfig } from "../../config-helpers.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { validateEntityListScreens } from "../entity-list-screens.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  function noteFeatureWithColumn(columnName: string, options?: { readonly softDelete?: boolean }) {
    return defineFeature("notes", (r) => {
      r.entity({
        name: "note",
        ...createEntity({
          fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
          softDelete: options?.softDelete,
        }),
      });
      r.screen({
        id: "note-list",
        type: "entityList",
        entity: "note",
        columns: ["title", columnName],
      });
    });
  }

  // The validator accepts `{ react: { __component: "Name" } }` for a
  // PlatformComponent resolved through the client-side registry and validates it
  // structurally. null/undefined, native-only, and other forms remain opaque.
  // Function renderers are rejected by `action-wiring.ts` because
  // JSON.stringify drops them, causing a silent client-side no-op.
  describe("entityList column renderer form", () => {
    function shopFeature(renderer: unknown) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          // The renderer is intentionally `unknown`: these tests also cover forms that
          // correctly authored TypeScript would reject, such as an empty `__component`
          // or a number.
          // kumiko-lint-ignore as-cast renderer is a test fixture for invalid forms
          columns: [{ field: "name", renderer: renderer as never }],
        });
      });
    }

    test("function-renderer → throws (Function is discarded by JSON.stringify)", () => {
      expect(() => validateBoot([shopFeature((v: unknown) => String(v))])).toThrow(
        /column "name" renderer is a function/,
      );
    });

    test("undefined renderer → no throw (column without renderer)", () => {
      expect(() => validateBoot([shopFeature(undefined)])).not.toThrow();
    });

    test("null renderer → no throw (skip)", () => {
      expect(() => validateBoot([shopFeature(null)])).not.toThrow();
    });

    test("object without react branch → no throw (e.g. native-only)", () => {
      expect(() => validateBoot([shopFeature({ native: { __component: "X" } })])).not.toThrow();
    });

    test("react branch is non-object → throws with a clear message", () => {
      expect(() => validateBoot([shopFeature({ react: 42 })])).toThrow(/non-object `react` branch/);
    });

    test("react branch without __component key → no throw (skip)", () => {
      // {} and { __component: undefined } are not the string-keyed form under test.
      expect(() => validateBoot([shopFeature({ react: {} })])).not.toThrow();
    });

    test("react.__component empty string → Throw", () => {
      expect(() => validateBoot([shopFeature({ react: { __component: "" } })])).toThrow(
        /expected a non-empty string/,
      );
    });

    test("react.__component non-String (number) → Throw", () => {
      expect(() => validateBoot([shopFeature({ react: { __component: 42 } })])).toThrow(
        /expected a non-empty string/,
      );
    });

    test("react.__component non-empty string → no throw (valid form)", () => {
      expect(() =>
        validateBoot([shopFeature({ react: { __component: "ColorSwatch" } })]),
      ).not.toThrow();
    });
  });

  // --- function-renderer check on the non-entityEdit/entityList screen
  // types that share the same EditLayout/ListColumnSpec shapes
  // (action-wiring.ts's validateEditLayoutNoFunctions/validateColumnsNoFunctions) ---
  describe("function-renderer check on other EditLayout/columns screens", () => {
    test("actionForm field renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.screen({
            id: "restock",
            type: "actionForm",
            handler: "shop:write:restock",
            fields: { qty: { type: "number" } } as never,
            layout: {
              sections: [
                { fields: [{ field: "qty", renderer: (v: unknown) => String(v) }] as never },
              ],
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(actionForm\) field "qty" renderer is a function/,
      );
    });

    test("configEdit field renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          r.config({
            keys: { "site-name": createTenantConfig("text", { default: "" }) },
          });
          r.screen({
            id: "settings",
            type: "configEdit",
            scope: "tenant",
            configKeys: { siteName: "shop:config:site-name" },
            fields: { siteName: { type: "text" } } as never,
            layout: {
              sections: [
                {
                  fields: [{ field: "siteName", renderer: (v: unknown) => String(v) }] as never,
                },
              ],
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(configEdit\) field "siteName" renderer is a function/,
      );
    });

    test("projectionDetail field renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          registerStubQueryHandler(r, "order-detail");
          r.screen({
            id: "order-detail",
            type: "projectionDetail",
            query: "shop:query:order-detail",
            layout: {
              sections: [
                { fields: [{ field: "total", renderer: (v: unknown) => String(v) }] as never },
              ],
            },
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(projectionDetail\) field "total" renderer is a function/,
      );
    });

    test("dashboard list-panel column renderer as a function → Throw", () => {
      const features = [
        defineFeature("shop", (r) => {
          registerStubQueryHandler(r, "recent-orders");
          r.screen({
            id: "overview",
            type: "dashboard",
            panels: [
              {
                kind: "list",
                id: "recent-orders",
                label: "Recent Orders",
                query: "shop:query:recent-orders",
                columns: [{ field: "total", renderer: (v: unknown) => String(v) }] as never,
              },
            ],
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(
        /\(dashboard-list\) column "total" renderer is a function/,
      );
    });
  });

  // A column whose `field` is not an entity field is allowed IF it carries a
  // `label` — a presentational column drawn by a columnRenderer component (e.g.
  // tag chips). Without a label an unknown field stays a boot error (typo guard).
  describe("entityList virtual labeled column", () => {
    function noteFeature(column: unknown) {
      return defineFeature("notes", (r) => {
        r.entity({
          name: "note",
          ...createEntity({
            fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({
          id: "note-list",
          type: "entityList",
          entity: "note",
          // kumiko-lint-ignore as-cast test fixture pins valid + invalid column forms
          columns: ["title", column as never],
        });
      });
    }

    test("labeled component column on a non-field → no throw", () => {
      expect(() =>
        validateBoot([
          noteFeature({
            field: "tags",
            label: "Tags",
            renderer: { react: { __component: "TagsCell" } },
          }),
        ]),
      ).not.toThrow();
    });

    test("unlabeled column on a non-field → Throw (unknown field)", () => {
      expect(() =>
        validateBoot([
          noteFeature({ field: "tags", renderer: { react: { __component: "TagsCell" } } }),
        ]),
      ).toThrow(/tags/);
    });

    test("labeled column on a non-field WITHOUT a renderer → Throw (label alone isn't enough)", () => {
      // Regression (697/1): renderer is what actually draws a virtual column —
      // a label with no renderer would push an empty, unrendered column into
      // the view model instead of a real typo-guard.
      expect(() => validateBoot([noteFeature({ field: "tags", label: "Tags" })])).toThrow(/tags/);
    });
  });

  // Row-meta columns are real base-table columns, never declared entity
  // fields — a SystemAdmin cross-tenant list exposes tenantId this way.
  //
  // Two separate boot-validators check entityList columns (validateScreens
  // here, validateEntityListScreens in entity-list-screens.ts) — a review
  // found they'd drifted to accept different column sets, which
  // would have let a softDelete column pass one gate and throw only in
  // computeListViewModel at render time. Table-driven over
  // LIST_ROW_META_COLUMNS (not one-off cases) so a future column added
  // there is proven against BOTH validators automatically. Companion
  // assertions: list.test.ts (headless renderer draws the same set) and
  // list-row-meta-drift.test.ts (LIST_ROW_META_COLUMNS key-set drift guard).
  describe("entityList row-meta column — accepted by both boot validators", () => {
    for (const softDelete of [false, true]) {
      for (const [columnName, columnType] of Object.entries(LIST_ROW_META_COLUMNS)) {
        test(`"${columnName}" (${columnType}) on a ${softDelete ? "softDelete" : "non-softDelete"} entity → no throw`, () => {
          const feature = noteFeatureWithColumn(columnName, { softDelete });
          expect(() => validateBoot([feature])).not.toThrow();
          const fixed = withBootValidatorFixture([feature]);
          expect(() => validateEntityListScreens(fixed)).not.toThrow();
        });
      }
    }

    // rowMetaFieldNames(true) also carries the softDelete-only columns
    // (isDeleted/deletedAt/deletedById) — real base-table columns, but
    // deliberately absent from LIST_ROW_META_COLUMNS because
    // computeListViewModel can't render them. Both validators must reject
    // them, or a softDelete column would pass boot and only throw at
    // render-time.
    const softDeleteOnlyColumns = [...rowMetaFieldNames(true)].filter(
      (name) => LIST_ROW_META_COLUMNS[name] === undefined,
    );
    test("softDelete-only row-meta set is exactly isDeleted/deletedAt/deletedById", () => {
      expect([...softDeleteOnlyColumns].sort()).toEqual(["deletedAt", "deletedById", "isDeleted"]);
    });

    for (const columnName of softDeleteOnlyColumns) {
      test(`"${columnName}" (softDelete-only, not renderable) → Throw on both validators`, () => {
        const feature = noteFeatureWithColumn(columnName, { softDelete: true });
        expect(() => validateBoot([feature])).toThrow(
          new RegExp(`references field "${columnName}" which does not exist`),
        );
        const fixed = withBootValidatorFixture([feature]);
        expect(() => validateEntityListScreens(fixed)).toThrow(
          new RegExp(`unknown column field "${columnName}"`),
        );
      });
    }
  });

  // --- entityList: typo columns must still fail (row-meta acceptance is
  // NOT a general gate-loosening) ---
  //
  // validateBoot only ever surfaces validateScreens' message here — it runs
  // before validateEntityListScreens in the per-feature loop (see
  // boot-validator/index.ts) and throws first. validateEntityListScreens'
  // own "unknown column field" message is only reachable by calling it
  // directly, which these tests also do.
  describe("entityList typo column → Throw on both validators (not silently accepted)", () => {
    const typoColumns = ["tenantID", "tenatId", "totallyMadeUp"];

    for (const typo of typoColumns) {
      test(`"${typo}" fails validateScreens (via validateBoot)`, () => {
        const feature = noteFeatureWithColumn(typo);
        expect(() => validateBoot([feature])).toThrow(
          new RegExp(`references field "${typo}" which does not exist`),
        );
      });

      test(`"${typo}" fails validateEntityListScreens directly ("unknown column field")`, () => {
        const feature = noteFeatureWithColumn(typo);
        const fixed = withBootValidatorFixture([feature]);
        expect(() => validateEntityListScreens(fixed)).toThrow(
          new RegExp(`unknown column field "${typo}"`),
        );
      });
    }
  });

  // Catch authoring errors before production so screens that fail to load, sort
  // incorrectly, or crash when paging are rejected at boot. These tests cover
  // server-side validation only; pager rendering belongs to the renderer.
  describe("entityList pagination + sort", () => {
    function makeFeature(
      override: Partial<{
        readonly pageSize: number;
        readonly defaultSort: { readonly field: string; readonly dir: "asc" | "desc" };
      }>,
    ) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: {
              name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
              // Intentionally not sortable: verifies that the validator distinguishes it
              // and accepts only sortable fields as `defaultSort` targets.
              description: createTextField({ personal: false, reason: "test_fixture" }),
            },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: "name" }],
          ...override,
        });
      });
    }

    test("pageSize: positive → no throw", () => {
      expect(() => validateBoot([makeFeature({ pageSize: 100 })])).not.toThrow();
    });

    test("pageSize: 0 → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature({ pageSize: 0 })])).toThrow(
        /pageSize=0 — must be a positive integer/,
      );
    });

    test("pageSize: negativ → Throw", () => {
      expect(() => validateBoot([makeFeature({ pageSize: -10 })])).toThrow(
        /pageSize=-10 — must be a positive integer/,
      );
    });

    test("defaultSort.field: exists + sortable=true → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ defaultSort: { field: "name", dir: "asc" } })]),
      ).not.toThrow();
    });

    test("defaultSort.field: does not exist → throw", () => {
      expect(() =>
        validateBoot([makeFeature({ defaultSort: { field: "ghost", dir: "asc" } })]),
      ).toThrow(/defaultSort references unknown field "ghost"/);
    });

    test("defaultSort.field: existiert aber sortable=false → Throw", () => {
      expect(() =>
        validateBoot([makeFeature({ defaultSort: { field: "description", dir: "asc" } })]),
      ).toThrow(/defaultSort\.field "description" is not sortable/);
    });
  });

  // `sortable` is supported by multiple field types, not just `TextFieldDef`.
  // The validator checks the `sortable` property on each field definition, so
  // these tests verify the per-field-type path.
  describe("entityList defaultSort: every sortable field type", () => {
    function buildFeature(fieldName: string, fields: Record<string, unknown>) {
      return defineFeature("shop", (r) => {
        r.entity({ name: "product", fields: fields as never });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: [{ field: fieldName }],
          defaultSort: { field: fieldName, dir: "asc" },
        });
      });
    }

    test("number field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("rank", { rank: { type: "number", sortable: true } })]),
      ).not.toThrow();
    });

    test("money field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("price", { price: { type: "money", sortable: true } })]),
      ).not.toThrow();
    });

    test("date field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("dueDate", { dueDate: { type: "date", sortable: true } })]),
      ).not.toThrow();
    });

    test("timestamp field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("createdAt", { createdAt: { type: "timestamp", sortable: true } }),
        ]),
      ).not.toThrow();
    });

    test("boolean field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([buildFeature("isActive", { isActive: { type: "boolean", sortable: true } })]),
      ).not.toThrow();
    });

    test("select field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("status", {
            status: { type: "select", options: ["a", "b"], sortable: true },
          }),
        ]),
      ).not.toThrow();
    });

    test("locatedTimestamp field with sortable: true → no throw", () => {
      expect(() =>
        validateBoot([
          buildFeature("pickup", { pickup: { type: "locatedTimestamp", sortable: true } }),
        ]),
      ).not.toThrow();
    });

    test("number field WITHOUT sortable → throws (sortable: true is required)", () => {
      expect(() => validateBootRaw([buildFeature("rank", { rank: { type: "number" } })])).toThrow(
        /is not sortable/,
      );
    });
  });
