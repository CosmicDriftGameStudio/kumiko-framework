import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { registerStubQueryHandler } from "../../__tests__/stub-query-handler.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("entityList rowAction kind=navigate", () => {
  function makeFeature(targetScreen: string, withTarget: boolean) {
    return defineFeature("shop", (r) => {
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
            id: "edit",
            label: "actions.edit",
            screen: targetScreen,
          },
        ],
      });
      if (withTarget) {
        r.screen({
          id: targetScreen,
          type: "custom",
          renderer: { react: "stub" },
        });
      }
    });
  }

  test("navigate-target → registered screen → no throw", () => {
    expect(() => validateBoot([makeFeature("product-edit", true)])).not.toThrow();
  });

  test("navigate-target → unknown screen → throws with a clear message", () => {
    expect(() => validateBoot([makeFeature("ghost-screen", false)])).toThrow(
      /rowAction "edit" navigate-target "ghost-screen" does not resolve/,
    );
  });

  test("navigate-target → screen in ANOTHER feature → no throw (cross-feature)", () => {
    // A declarative list in the entity's owning feature can navigate to a
    // consumer application's custom editor in another feature. Runtime
    // resolves the bare ID application-wide, so the validator must allow it.
    const list = defineFeature("shop", (r) => {
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
          { kind: "navigate", id: "edit", label: "actions.edit", screen: "product-editor" },
        ],
      });
    });
    const consumer = defineFeature("app", (r) => {
      r.screen({ id: "product-editor", type: "custom", renderer: { react: "stub" } });
    });
    expect(() => validateBoot([list, consumer])).not.toThrow();
  });

  test("cross-feature navigate to an entityEdit screen WITHOUT entityId → Throw", () => {
    // Regression: the renderer's same-feature row["id"] fallback never
    // fires for a cross-feature target, so the edit screen would silently
    // open with no entity context at runtime. The validator must catch it
    // at boot instead.
    const list = defineFeature("shop", (r) => {
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
          { kind: "navigate", id: "edit", label: "actions.edit", screen: "invoice-edit" },
        ],
      });
    });
    const consumer = defineFeature("billing", (r) => {
      r.entity(
        createEntity({
          name: "invoice",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "invoice-edit",
        type: "entityEdit",
        entity: "invoice",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([list, consumer])).toThrow(
      /rowAction "edit".*cross-feature to entityEdit screen "invoice-edit".*without an explicit entityId/,
    );
  });

  test("cross-feature navigate to an entityEdit screen WITH entityId → no throw", () => {
    const list = defineFeature("shop", (r) => {
      r.entity(
        createEntity({
          name: "product",
          fields: {
            name: createTextField({ personal: false, reason: "test_fixture" }),
            invoiceId: createTextField({ personal: false, reason: "test_fixture" }),
          },
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
            id: "edit",
            label: "actions.edit",
            screen: "invoice-edit",
            entityId: "invoiceId",
          },
        ],
      });
    });
    const consumer = defineFeature("billing", (r) => {
      r.entity(
        createEntity({
          name: "invoice",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "invoice-edit",
        type: "entityEdit",
        entity: "invoice",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([list, consumer])).not.toThrow();
  });

  test("same-feature navigate to entityEdit WITHOUT entityId → no throw (same-feature fallback applies)", () => {
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
          { kind: "navigate", id: "edit", label: "actions.edit", screen: "product-edit" },
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
});

describe("entityList rowAction kind=navigate entity-target", () => {
  test("entity-target resolving via detailFor → no throw", () => {
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
        rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
      });
      r.screen({
        id: "product-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "product",
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("entity-target with no detailFor screen anywhere → throws with a clear message", () => {
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
        rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /rowAction "view" navigate-target entity "product" has no screen declaring detailFor: "product"/,
    );
  });

  test("both screen and entity set → Throw", () => {
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
            screen: "product-detail",
            entity: "product",
          } as never,
        ],
      });
      r.screen({
        id: "product-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "product",
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /rowAction "view" sets both "screen" and "entity"/,
    );
  });

  test("neither screen nor entity set → Throw", () => {
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
        rowActions: [{ kind: "navigate", id: "view", label: "actions.view" } as never],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /rowAction "view" sets neither "screen" nor "entity"/,
    );
  });

  test("entity-target resolving cross-feature to a NON-entityEdit detailFor screen → no throw", () => {
    // Mirrors the existing cross-feature screen-target case above, but via
    // detailFor resolution — the owning feature's list navigates to a
    // detail screen a consumer app registers for the entity.
    const list = defineFeature("shop", (r) => {
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
        rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
      });
    });
    const consumer = defineFeature("app", (r) => {
      r.screen({
        id: "product-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "product",
      });
    });
    expect(() => validateBoot([list, consumer])).not.toThrow();
  });

  test("entity-target resolving cross-feature to an entityEdit detailFor screen WITHOUT entityId → no throw", () => {
    // Regression guard: the cross-feature-entityEdit-needs-explicit-entityId
    // check (screen-target branch) must NOT fire for entity-targets — the
    // renderer always supplies an id for those (explicit entityId, else
    // row["id"]), so the same-feature-fallback gap that check guards
    // against doesn't exist here.
    const list = defineFeature("shop", (r) => {
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
        rowActions: [{ kind: "navigate", id: "edit", label: "actions.edit", entity: "invoice" }],
      });
    });
    const consumer = defineFeature("billing", (r) => {
      r.entity(
        createEntity({
          name: "invoice",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "invoice-edit",
        type: "entityEdit",
        entity: "invoice",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
        detailFor: "invoice",
      });
    });
    expect(() => validateBoot([list, consumer])).not.toThrow();
  });

  test("projectionList rowAction entity-target without explicit entityId → Throw", () => {
    // projectionList rows come from an arbitrary query projection with no
    // guaranteed "id" field, unlike entityList rows — an entity-target
    // there must name the field to read the id from.
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
        rowActions: [{ kind: "navigate", id: "view", label: "actions.view", entity: "product" }],
      });
      r.screen({
        id: "product-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "product",
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /rowAction "view" navigate-target entity "product" needs an explicit "entityId"/,
    );
  });

  test("projectionList rowAction entity-target with explicit entityId → no throw", () => {
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
            id: "view",
            label: "actions.view",
            entity: "product",
            entityId: "productId",
          },
        ],
      });
      r.screen({
        id: "product-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "product",
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("projectionDetail action entity-target without explicit entityId → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "order-detail");
      r.entity(
        createEntity({
          name: "product",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: { sections: [{ fields: ["total"] }] },
        actions: [
          { kind: "navigate", id: "view-product", label: "actions.view", entity: "product" },
        ],
      });
      r.screen({
        id: "product-detail",
        type: "custom",
        renderer: { react: "stub" },
        detailFor: "product",
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /action "view-product" navigate-target entity "product" needs an explicit "entityId"/,
    );
  });
});
