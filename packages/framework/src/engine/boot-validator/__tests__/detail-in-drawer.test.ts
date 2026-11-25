import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { RowActionDrawer } from "@cosmicdrift/kumiko-types/screen";
import { registerStubQueryHandler } from "../../__tests__/stub-query-handler.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { validateEntityListScreens } from "../entity-list-screens.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("projectionDetail as a drawer target", () => {
  test("a rowAction may open a projectionDetail in the drawer", () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "orders");
      registerStubQueryHandler(r, "order-detail");
      r.screen({
        id: "order-list",
        type: "projectionList",
        query: "shop:query:orders",
        columns: [{ field: "name", label: "shop:col:name" }],
        rowActions: [
          {
            kind: "drawer",
            id: "open",
            label: "shop:action:open",
            screen: "order-detail",
            rowClick: true,
            width: "wide",
          },
        ],
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: { sections: [{ fields: ["total"] }] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("a projectionDetail header action cannot open a projectionDetail in the drawer", () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "order-detail");
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: { sections: [{ fields: ["total"] }] },
        actions: [{ kind: "drawer", id: "view", label: "shop:action:again", screen: "other" }],
      });
      r.screen({
        id: "other",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: { sections: [{ fields: ["total"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /action "view" drawer-target "other" is a "projectionDetail" screen, not an actionForm/,
    );
  });

  test("a toolbarAction cannot open a projectionDetail (no row id)", () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "orders");
      registerStubQueryHandler(r, "order-detail");
      r.screen({
        id: "order-list",
        type: "projectionList",
        query: "shop:query:orders",
        columns: [{ field: "name", label: "shop:col:name" }],
        toolbarActions: [
          { kind: "drawer", id: "open", label: "shop:action:open", screen: "order-detail" },
        ],
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: { sections: [{ fields: ["total"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /toolbarAction "open" drawer-target "order-detail" is a "projectionDetail" screen/,
    );
  });
});

describe("entity-list/detail-without-navigate with a drawer detail", () => {
  function featureWith(opts: {
    readonly rowActions: readonly RowActionDrawer[];
    readonly detailFor: string;
  }) {
    return defineFeature("shop", (r) => {
      r.entity(
        createEntity({
          name: "product",
          fields: {
            name: createTextField({ personal: false, reason: "test_fixture", sortable: true }),
          },
        }),
      );
      registerStubQueryHandler(r, "product-detail");
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ title: "Basics", fields: ["name"] }] },
      });
      r.screen({
        id: "product-detail",
        type: "projectionDetail",
        detailFor: opts.detailFor,
        query: "shop:query:product-detail",
        layout: { sections: [{ fields: ["name"] }] },
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
        rowActions: [...opts.rowActions],
      });
    });
  }

  const rowClickDrawer: RowActionDrawer = {
    kind: "drawer",
    id: "open",
    label: "shop:action:open",
    screen: "product-detail",
    rowClick: true,
  };

  test("a rowClick drawer onto the projectionDetail of the entity satisfies the rule", () => {
    expect(() =>
      validateEntityListScreens([
        featureWith({ rowActions: [rowClickDrawer], detailFor: "product" }),
      ]),
    ).not.toThrow();
  });

  test("a drawer without rowClick does not satisfy the rule", () => {
    const { rowClick: _rowClick, ...withoutRowClick } = rowClickDrawer;
    expect(() =>
      validateEntityListScreens([
        featureWith({ rowActions: [withoutRowClick], detailFor: "product" }),
      ]),
    ).toThrow(/detail screen exists/);
  });

  test("a drawer onto a projectionDetail of another entity does not satisfy the rule", () => {
    expect(() =>
      validateEntityListScreens([
        featureWith({ rowActions: [rowClickDrawer], detailFor: "order" }),
      ]),
    ).toThrow(/detail screen exists/);
  });
});
