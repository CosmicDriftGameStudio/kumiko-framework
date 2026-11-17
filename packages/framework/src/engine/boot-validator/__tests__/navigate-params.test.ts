import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { registerStubQueryHandler } from "../../__tests__/stub-query-handler.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import type { RowFieldExtractor } from "../../types/screen.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("submitPrefilled on navigate targets", () => {
  type TargetType = "secretMint" | "actionForm";
  function makeFeature(opts: {
    readonly submitPrefilled?: boolean;
    readonly targetType?: TargetType;
    readonly params?: RowFieldExtractor | null;
    readonly targetFields?: Record<string, unknown>;
    readonly layoutFields?: readonly unknown[];
    readonly targetScreen?: string;
  }) {
    const targetType = opts.targetType ?? "secretMint";
    const params = opts.params === undefined ? { pick: ["id"] } : opts.params;
    return defineFeature("shop", (r) => {
      r.queryHandler({
        name: "products",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.writeHandler({
        name: "rotate",
        schema: z.object({ id: z.string() }),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: { roles: ["Admin"] },
      });
      r.screen({
        id: "product-projection",
        type: "projectionList",
        query: "shop:query:products",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "rotate",
            label: "actions.rotate",
            screen: opts.targetScreen ?? "rotate-form",
            ...(params !== null && { params }),
          },
        ],
      });
      const common = {
        id: "rotate-form",
        handler: "shop:write:rotate",
        fields: (opts.targetFields ?? { id: { type: "text", required: true } }) as never,
        layout: {
          sections: [{ fields: [...(opts.layoutFields ?? [{ field: "id", visible: false }])] }],
        } as never,
        ...(opts.submitPrefilled !== undefined && { submitPrefilled: opts.submitPrefilled }),
      };
      if (targetType === "secretMint") {
        r.screen({
          ...common,
          type: "secretMint",
          reveal: { fields: [{ field: "token", label: "shop:screen:rotate-form.field:token" }] },
        });
      } else {
        r.screen({ ...common, type: "actionForm" });
      }
    });
  }

  for (const targetType of ["secretMint", "actionForm"] as const) {
    test(`${targetType}: params + hidden required field covered → no throw`, () => {
      expect(() =>
        validateBoot([makeFeature({ submitPrefilled: true, targetType })]),
      ).not.toThrow();
    });
  }

  test("a navigate target given as a QN seeds the hidden required field → no throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          submitPrefilled: true,
          targetType: "actionForm",
          targetScreen: "shop:screen:rotate-form",
        }),
      ]),
    ).not.toThrow();
  });

  test("params key the target does not declare → throw", () => {
    expect(() =>
      validateBoot([makeFeature({ submitPrefilled: true, params: { pick: ["nope", "id"] } })]),
    ).toThrow(
      /rowAction "rotate" params prefills "nope", which navigate-target "rotate-form" does not declare as a field/,
    );
  });

  test("params key the target layout does not render → throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          submitPrefilled: true,
          params: { pick: ["id", "extra"] },
          targetFields: { id: { type: "text", required: true }, extra: { type: "text" } },
          layoutFields: [{ field: "id", visible: false }],
        }),
      ]),
    ).toThrow(
      /params prefills "extra", which navigate-target "rotate-form" does not render in its layout/,
    );
  });

  test("params key the target marks sensitive → throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          submitPrefilled: true,
          params: { pick: ["id", "secret"] },
          targetFields: {
            id: { type: "text", required: true },
            secret: { type: "text", sensitive: true },
          },
          layoutFields: [{ field: "id", visible: false }, "secret"],
        }),
      ]),
    ).toThrow(/params prefills "secret", which navigate-target "rotate-form" marks as sensitive/);
  });

  test("hidden required field no navigate action passes → throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          submitPrefilled: true,
          params: { pick: ["other"] },
          targetFields: { id: { type: "text", required: true }, other: { type: "text" } },
          layoutFields: [{ field: "id", visible: false }, "other"],
        }),
      ]),
    ).toThrow(
      /Screen "rotate-form" \(secretMint\) sets submitPrefilled but hides required field "id"/,
    );
  });

  test("hidden required field with no navigate source at all → throw", () => {
    expect(() => validateBoot([makeFeature({ submitPrefilled: true, params: null })])).toThrow(
      /hides required field "id"/,
    );
  });

  test("hidden optional field needs no navigate source", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          submitPrefilled: true,
          params: null,
          targetFields: { id: { type: "text" } },
        }),
      ]),
    ).not.toThrow();
  });

  describe("sources that do not run validateRowActionNavigateParams", () => {
    function featureWithDetailSource(
      source: "metric" | "relatedListToolbar",
      params: RowFieldExtractor | undefined,
    ) {
      return defineFeature("shop", (r) => {
        r.queryHandler({
          name: "order:detail",
          schema: z.object({}),
          handler: async () => ({ total: 1 }),
          access: { roles: ["Admin"] },
        });
        r.queryHandler({
          name: "order:items",
          schema: z.object({}),
          handler: async () => ({ rows: [] }),
          access: { roles: ["Admin"] },
        });
        r.writeHandler({
          name: "rotate",
          schema: z.object({ id: z.string() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order:detail",
          ...(source === "metric" && {
            metrics: [
              {
                field: "total",
                label: "shop:screen:order-detail.metric:total",
                navigate: { screen: "rotate-form", ...(params && { params }) },
              },
            ],
          }),
          layout: {
            sections:
              source === "metric"
                ? [{ title: "s", fields: ["total"] }]
                : [
                    {
                      kind: "relatedList",
                      title: "Items",
                      query: "shop:query:order:items",
                      columns: ["name"],
                      parentParam: "orderId",
                      toolbarActions: [
                        {
                          kind: "navigate",
                          id: "rotate",
                          label: "actions.rotate",
                          screen: "rotate-form",
                          ...(params && { params }),
                        },
                      ],
                    },
                  ],
          },
        });
        r.screen({
          id: "rotate-form",
          type: "secretMint",
          handler: "shop:write:rotate",
          submitPrefilled: true,
          fields: {
            id: { type: "text", required: true },
            secret: { type: "text", sensitive: true },
          } as never,
          layout: {
            sections: [{ fields: [{ field: "id", visible: false }, "secret"] }],
          } as never,
          reveal: { fields: [{ field: "token", label: "shop:screen:rotate-form.field:token" }] },
        });
      });
    }

    test("a metric navigate with a sensitive param key → throw", () => {
      expect(() =>
        validateBoot([featureWithDetailSource("metric", { pick: ["id", "secret"] })]),
      ).toThrow(/params prefills "secret", which navigate-target "rotate-form" marks as sensitive/);
    });

    test("a metric navigate with a covering param boots", () => {
      expect(() =>
        validateBoot([featureWithDetailSource("metric", { pick: ["id"] })]),
      ).not.toThrow();
    });

    test("a relatedList toolbarAction without params prefills its implicit parent param → throw when undeclared", () => {
      expect(() =>
        validateBoot([featureWithDetailSource("relatedListToolbar", undefined)]),
      ).toThrow(
        /params prefills "orderId", which navigate-target "rotate-form" does not declare as a field/,
      );
    });
  });

  test("submitPrefilled absent → none of the new checks fire", () => {
    expect(() => validateBoot([makeFeature({ params: { pick: ["nope"] } })])).not.toThrow();
    expect(() => validateBoot([makeFeature({ params: null })])).not.toThrow();
  });

  test("submitPrefilled on an entityEdit screen (untyped schema) → throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        createEntity({
          name: "product",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ fields: ["name"] }] },
        submitPrefilled: true,
      } as never);
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "product-edit" \(entityEdit\) sets submitPrefilled/,
    );
  });
});

test("navigate with params targeting a dashboard screen without a filter → Throw (params would be a no-op)", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "view",
          label: "actions.view",
          screen: "product-dashboard",
          params: { pick: ["name"] },
        },
      ],
    });
    r.queryHandler({
      name: "count",
      schema: z.object({}),
      handler: async () => ({ total: 0 }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "product-dashboard",
      type: "dashboard",
      panels: [
        {
          kind: "stat",
          id: "count",
          label: "Products",
          query: "shop:query:count",
          valueField: "total",
        },
      ],
    });
  });
  expect(() => validateBoot([feature])).toThrow(
    /sets params on navigate-target "product-dashboard" \(dashboard\).*declares no filter.*no-op/,
  );
});

test("navigate with params targeting a dashboard screen with a matching filter → no throw (useFilterParams reads it)", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "view",
          label: "actions.view",
          screen: "product-dashboard",
          params: { map: { category: "name" } },
        },
      ],
    });
    r.queryHandler({
      name: "count",
      schema: z.object({}),
      handler: async () => ({ total: 0 }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "product-dashboard",
      type: "dashboard",
      filter: {
        id: "category",
        label: "Category",
        kind: "select",
        options: [{ value: "a", label: "A" }],
      },
      panels: [
        {
          kind: "stat",
          id: "count",
          label: "Products",
          query: "shop:query:count",
          valueField: "total",
        },
      ],
    });
  });
  expect(() => validateBoot([feature])).not.toThrow();
});

test("navigate with params targeting a record-bound dashboard without a filter → no throw (record.param is read from the URL)", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "view",
          label: "actions.view",
          screen: "product-dashboard",
          params: { map: { productId: "name" } },
        },
      ],
    });
    r.queryHandler({
      name: "count",
      schema: z.object({}),
      handler: async () => ({ total: 0 }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "product-dashboard",
      type: "dashboard",
      record: { param: "productId" },
      panels: [
        {
          kind: "stat",
          id: "count",
          label: "Products",
          query: "shop:query:count",
          valueField: "total",
        },
      ],
    });
  });
  expect(() => validateBoot([feature])).not.toThrow();
});

test("navigate with params targeting a record-bound dashboard whose record.param is not extracted → Throw", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "view",
          label: "actions.view",
          screen: "product-dashboard",
          params: { map: { other: "name" } },
        },
      ],
    });
    r.queryHandler({
      name: "count",
      schema: z.object({}),
      handler: async () => ({ total: 0 }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "product-dashboard",
      type: "dashboard",
      record: { param: "productId" },
      panels: [
        {
          kind: "stat",
          id: "count",
          label: "Products",
          query: "shop:query:count",
          valueField: "total",
        },
      ],
    });
  });
  expect(() => validateBoot([feature])).toThrow(
    /URL params are \[productId\].*none of the extracted keys match/,
  );
});

test("navigate with params targeting a dashboard screen whose filter id doesn't match any extracted key → Throw", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "view",
          label: "actions.view",
          screen: "product-dashboard",
          params: { map: { productName: "name" } },
        },
      ],
    });
    r.queryHandler({
      name: "count",
      schema: z.object({}),
      handler: async () => ({ total: 0 }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "product-dashboard",
      type: "dashboard",
      filter: {
        id: "category",
        label: "Category",
        kind: "select",
        options: [{ value: "a", label: "A" }],
      },
      panels: [
        {
          kind: "stat",
          id: "count",
          label: "Products",
          query: "shop:query:count",
          valueField: "total",
        },
      ],
    });
  });
  expect(() => validateBoot([feature])).toThrow(
    /sets params \[productName\] on navigate-target "product-dashboard" \(dashboard\) whose filter id is "category".*none of the extracted keys match/,
  );
});

test("navigate with params targeting a cross-entity entityList screen → no throw (list screens read URL search params for filter-prefill)", () => {
  const feature = defineFeature("housing", (r) => {
    r.entity(
      createEntity({
        name: "unit",
        fields: { id: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.entity(
      createEntity({
        name: "contract",
        fields: { unitId: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "unit-list",
      type: "entityList",
      entity: "unit",
      columns: ["id"],
      rowActions: [
        {
          kind: "navigate",
          id: "view-contracts",
          label: "actions.viewContracts",
          screen: "contract-list",
          params: { map: { "housing:contract-list.f.unitId": "id" } },
        },
      ],
    });
    r.screen({
      id: "contract-list",
      type: "entityList",
      entity: "contract",
      columns: ["unitId"],
    });
  });
  expect(() => validateBoot([feature])).not.toThrow();
});

test("navigate with params targeting a custom screen → no throw (author owns the component, may read searchParams itself)", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "view",
          label: "actions.view",
          screen: "product-dashboard",
          params: { pick: ["name"] },
        },
      ],
    });
    r.screen({
      id: "product-dashboard",
      type: "custom",
      renderer: { react: "stub" },
    });
  });
  expect(() => validateBoot([feature])).not.toThrow();
});

test("navigate with params targeting a same-entity entityEdit screen → Throw (resolves to update mode)", () => {
  // No explicit entityId + same entity as the source list → the renderer's
  // runNavigate() auto-fills row["id"], landing in EntityEditUpdateBody,
  // which never reads searchParams. Params would silently no-op.
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "open",
          label: "actions.open",
          screen: "product-edit",
          params: { pick: ["name"] },
        },
      ],
    });
    r.screen({
      id: "product-edit",
      type: "entityEdit",
      entity: "product",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
    });
  });
  expect(() => validateBoot([feature])).toThrow(
    /resolves to UPDATE mode.*same entity "product" auto-fills row\["id"\]/,
  );
});

test("navigate with params + explicit entityId targeting an entityEdit screen → Throw (forced update mode)", () => {
  const feature = defineFeature("housing", (r) => {
    r.entity(
      createEntity({
        name: "unit",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.entity(
      createEntity({
        name: "contract",
        fields: { unitId: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "unit-list",
      type: "entityList",
      entity: "unit",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "edit-contract",
          label: "actions.edit-contract",
          screen: "contract-edit",
          entityId: "name",
          params: { pick: ["name"] },
        },
      ],
    });
    r.screen({
      id: "contract-edit",
      type: "entityEdit",
      entity: "contract",
      layout: { sections: [{ columns: 1, fields: ["unitId"] }] },
    });
  });
  expect(() => validateBoot([feature])).toThrow(
    /resolves to UPDATE mode \(explicit entityId "name"\)/,
  );
});

// The same params-vs-update-mode check as entityList,
// extended to projectionList rowActions (entityList is covered separately).
test("projectionList rowAction: navigate with params to an entityEdit target + explicit entityId → Throw", () => {
  const feature = defineFeature("shop", (r) => {
    registerStubQueryHandler(r, "products");
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "product-projection",
      type: "projectionList",
      query: "shop:query:products",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "open",
          label: "actions.open",
          screen: "product-edit",
          entityId: "name",
          params: { pick: ["name"] },
        },
      ],
    });
    r.screen({
      id: "product-edit",
      type: "entityEdit",
      entity: "product",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
    });
  });
  expect(() => validateBoot([feature])).toThrow(
    /\(projectionList\) rowAction "open".*resolves to UPDATE mode \(explicit entityId "name"\)/,
  );
});

test("projectionList rowAction: navigate with params to an entityEdit-create target (no entityId) → no throw", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.queryHandler({
      name: "products",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "product-projection",
      type: "projectionList",
      query: "shop:query:products",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "open",
          label: "actions.open",
          screen: "product-edit",
          params: { pick: ["name"] },
        },
      ],
    });
    r.screen({
      id: "product-edit",
      type: "entityEdit",
      entity: "product",
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
    });
  });
  expect(() => validateBoot([feature])).not.toThrow();
});

test("navigate with params targeting a cross-entity entityEdit screen (no explicit entityId) → no throw", () => {
  // The issue's actual use case: a unit row navigates to "create contract"
  // pre-filled with unitId. Different entity + no explicit entityId → the
  // renderer's same-entity row["id"] fallback does NOT fire, so this stays
  // in create mode and EntityEditCreateBody reads the params.
  const feature = defineFeature("housing", (r) => {
    r.entity(
      createEntity({
        name: "unit",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.entity(
      createEntity({
        name: "contract",
        fields: { unitId: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.screen({
      id: "unit-list",
      type: "entityList",
      entity: "unit",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "create-contract",
          label: "actions.create-contract",
          screen: "contract-edit",
          params: { map: { unitId: "name" } },
        },
      ],
    });
    r.screen({
      id: "contract-edit",
      type: "entityEdit",
      entity: "contract",
      layout: { sections: [{ columns: 1, fields: ["unitId"] }] },
    });
  });
  expect(() => validateBoot([feature])).not.toThrow();
});

test("navigate with params targeting an actionForm screen → no throw", () => {
  const feature = defineFeature("shop", (r) => {
    r.entity(
      createEntity({
        name: "product",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.writeHandler({
      name: "create",
      schema: z.object({ name: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: { id: "1" } }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      rowActions: [
        {
          kind: "navigate",
          id: "open-form",
          label: "actions.form",
          screen: "product-form",
          params: { pick: ["name"] },
        },
      ],
    });
    r.screen({
      id: "product-form",
      type: "actionForm",
      handler: "shop:write:create",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      layout: { sections: [{ columns: 1, fields: ["name"] }] },
    });
  });
  expect(() => validateBoot([feature])).not.toThrow();
});
