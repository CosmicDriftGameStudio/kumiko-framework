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

// --- action/rowAction drawer-target reachability across the remaining
//     RowAction call sites: projectionDetail.actions,
//     entityEdit.actions, and a relatedList section's rowActions. The
//     entityList/projectionList rowAction and toolbarAction drawer cases
//     are covered above — this pins the drawer branch actually being
//     reached (not skipped/mis-nested) at the other three sites, and the
//     "action" actionLabel used by both non-list call sites. ---
describe("drawer-target reachability at the remaining RowAction call sites", () => {
  test('projectionDetail.actions drawer-target unknown → throw with actionLabel "action"', () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "order-detail");
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: { sections: [{ fields: ["total"] }] },
        actions: [
          { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "ghost-form" },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /action "add-note" drawer-target "ghost-form" does not resolve to a registered screen/,
    );
  });

  test('entityEdit.actions drawer-target unknown → throw with actionLabel "action"', () => {
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
        layout: { sections: [{ title: "Basics", fields: ["name"] }] },
        actions: [
          { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "ghost-form" },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /action "add-note" drawer-target "ghost-form" does not resolve to a registered screen/,
    );
  });

  test("entityEdit header action with a malformed clientAction name → throw", () => {
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
        layout: { sections: [{ title: "Basics", fields: ["name"] }] },
        actions: [{ kind: "clientAction", id: "send", label: "actions.send", action: "Not Valid" }],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /\(entityEdit\) action "send" action "Not Valid" is not a client action name/,
    );
  });

  test("entityEdit.actions drawer-target → registered actionForm → no throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        createEntity({
          name: "product",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.writeHandler({
        name: "add-note",
        schema: z.object({ note: z.string() }),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: { roles: ["Admin"] },
      });
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: { sections: [{ title: "Basics", fields: ["name"] }] },
        actions: [
          { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "note-form" },
        ],
      });
      r.screen({
        id: "note-form",
        type: "actionForm",
        handler: "shop:write:add-note",
        fields: { note: { type: "text" } } as never,
        layout: { sections: [{ fields: ["note"] }] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test('projectionDetail relatedList section rowAction drawer-target unknown → throw with actionLabel "rowAction"', () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "order-detail");
      registerStubQueryHandler(r, "order-positions");
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Positions",
              query: "shop:query:order-positions",
              columns: [{ field: "name" }],
              rowActions: [
                {
                  kind: "drawer",
                  id: "add-note",
                  label: "actions.addNote",
                  screen: "ghost-form",
                },
              ],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /rowAction "add-note" drawer-target "ghost-form" does not resolve to a registered screen/,
    );
  });

  test("projectionDetail tabs-mode fields section with both groups and actions → throw", () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "order-detail");
      registerStubQueryHandler(r, "order-positions");
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: {
          mode: "tabs",
          sections: [
            {
              id: "billing",
              title: "Billing",
              groups: [{ title: "Amounts", fields: ["name"] }],
              actions: [
                { kind: "navigate", id: "edit", label: "actions.edit", screen: "order-detail" },
              ],
            },
            {
              id: "positions",
              kind: "relatedList",
              title: "Positions",
              query: "shop:query:order-positions",
              columns: [{ field: "name" }],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /section "billing" declares both groups and actions in tabs mode/,
    );
  });

  test("projectionDetail relatedList defaultSort.field not a listed column → throw", () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "order-detail");
      registerStubQueryHandler(r, "order-positions");
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Positions",
              query: "shop:query:order-positions",
              columns: [{ field: "name", sortable: true }],
              defaultSort: { field: "price", dir: "asc" },
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /defaultSort\.field "price" is not a listed column/,
    );
  });

  test("projectionDetail relatedList defaultSort.field not sortable → throw", () => {
    const feature = defineFeature("shop", (r) => {
      registerStubQueryHandler(r, "order-detail");
      registerStubQueryHandler(r, "order-positions");
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Positions",
              query: "shop:query:order-positions",
              columns: [{ field: "name" }],
              defaultSort: { field: "name", dir: "asc" },
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/defaultSort\.field "name" is not sortable/);
  });

  test("projectionDetail relatedList defaultSort.field sortable → no throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.queryHandler({
        name: "order-detail",
        schema: z.object({}),
        handler: async () => ({ id: "o1" }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.queryHandler({
        name: "order-positions",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order-detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Positions",
              query: "shop:query:order-positions",
              columns: [{ field: "name", sortable: true }],
              defaultSort: { field: "name", dir: "asc" },
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});

describe("entityList toolbarAction drawer", () => {
  function makeFeature(opts: {
    readonly targetId?: string;
    readonly targetType?: "actionForm" | "entityList";
  }) {
    const targetId = opts.targetId ?? "restock-form";
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
        toolbarActions: [
          { kind: "drawer", id: "open-drawer", label: "actions.restock", screen: targetId },
        ],
      });
      if (opts.targetType === "entityList") {
        r.screen({
          id: targetId,
          type: "entityList",
          entity: "product",
          columns: ["name"],
        });
        return;
      }
      if (opts.targetType === "actionForm") {
        r.writeHandler({
          name: "restock",
          schema: z.object({ qty: z.number() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: targetId,
          type: "actionForm",
          handler: "shop:write:restock",
          fields: { qty: { type: "number" } } as never,
          layout: { sections: [{ fields: ["qty"] }] },
        });
      }
    });
  }

  test("drawer-target → registered actionForm → no throw", () => {
    expect(() => validateBoot([makeFeature({ targetType: "actionForm" })])).not.toThrow();
  });

  test("drawer-target → unknown → throw with a clear message", () => {
    expect(() => validateBoot([makeFeature({ targetId: "ghost-form" })])).toThrow(
      /toolbarAction "open-drawer" drawer-target "ghost-form" does not resolve to a registered screen/,
    );
  });

  test("drawer-target → screen exists but is not an actionForm → throw with a clear message", () => {
    expect(() =>
      validateBoot([makeFeature({ targetId: "product-list-2", targetType: "entityList" })]),
    ).toThrow(
      /toolbarAction "open-drawer" drawer-target "product-list-2" is a "entityList" screen, not an actionForm/,
    );
  });

  test("drawer-target → actionForm in ANOTHER feature → throw (drawer resolves same-feature only)", () => {
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
        toolbarActions: [
          { kind: "drawer", id: "open-drawer", label: "actions.restock", screen: "restock-form" },
        ],
      });
    });
    const consumer = defineFeature("app", (r) => {
      r.writeHandler({
        name: "restock",
        schema: z.object({ qty: z.number() }),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: { roles: ["Admin"] },
      });
      r.screen({
        id: "restock-form",
        type: "actionForm",
        handler: "app:write:restock",
        fields: { qty: { type: "number" } } as never,
        layout: { sections: [{ fields: ["qty"] }] },
      });
    });
    expect(() => validateBoot([list, consumer])).toThrow(
      /toolbarAction "open-drawer" drawer-target "restock-form" does not resolve to a registered screen in this feature/,
    );
  });
});

describe("entityList rowAction drawer", () => {
  function makeFeature(opts: {
    readonly targetId?: string;
    readonly targetType?: "actionForm" | "entityList";
  }) {
    const targetId = opts.targetId ?? "restock-form";
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
          { kind: "drawer", id: "open-drawer", label: "actions.restock", screen: targetId },
        ],
      });
      if (opts.targetType === "entityList") {
        r.screen({
          id: targetId,
          type: "entityList",
          entity: "product",
          columns: ["name"],
        });
        return;
      }
      if (opts.targetType === "actionForm") {
        r.writeHandler({
          name: "restock",
          schema: z.object({ qty: z.number() }),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
        r.screen({
          id: targetId,
          type: "actionForm",
          handler: "shop:write:restock",
          fields: { qty: { type: "number" } } as never,
          layout: { sections: [{ fields: ["qty"] }] },
        });
      }
    });
  }

  test("drawer-target → registered actionForm → no throw", () => {
    expect(() => validateBoot([makeFeature({ targetType: "actionForm" })])).not.toThrow();
  });

  test("drawer-target → unknown → throw with a clear message", () => {
    expect(() => validateBoot([makeFeature({ targetId: "ghost-form" })])).toThrow(
      /rowAction "open-drawer" drawer-target "ghost-form" does not resolve to a registered screen/,
    );
  });

  test("drawer-target → screen exists but is not an actionForm → throw with a clear message", () => {
    expect(() =>
      validateBoot([makeFeature({ targetId: "product-list-2", targetType: "entityList" })]),
    ).toThrow(
      /rowAction "open-drawer" drawer-target "product-list-2" is a "entityList" screen, not an actionForm/,
    );
  });
});

// projectionList is the second list call site; its rowActions run through a
// different branch of validateScreens than entityList's. The params cases
// pin the prefill check: a key the target actionForm doesn't declare is
// dropped by the renderer, so it has to fail at boot instead.
describe("projectionList rowAction drawer", () => {
  function makeFeature(opts: {
    readonly targetId?: string;
    readonly params?: RowFieldExtractor;
    readonly targetFields?: Record<string, unknown>;
    readonly layoutFields?: readonly string[];
  }) {
    const targetId = opts.targetId ?? "restock-form";
    return defineFeature("shop", (r) => {
      r.queryHandler({
        name: "products",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.writeHandler({
        name: "restock",
        schema: z.object({ qty: z.number() }),
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
            kind: "drawer",
            id: "open-drawer",
            label: "actions.restock",
            screen: targetId,
            ...(opts.params !== undefined && { params: opts.params }),
          },
        ],
      });
      r.screen({
        id: "restock-form",
        type: "actionForm",
        handler: "shop:write:restock",
        fields: (opts.targetFields ?? { qty: { type: "number" } }) as never,
        layout: { sections: [{ fields: [...(opts.layoutFields ?? ["qty"])] }] },
      });
    });
  }

  test("drawer-target → registered actionForm → no throw", () => {
    expect(() => validateBoot([makeFeature({})])).not.toThrow();
  });

  test("drawer-target → unknown → throw with a clear message", () => {
    expect(() => validateBoot([makeFeature({ targetId: "ghost-form" })])).toThrow(
      /rowAction "open-drawer" drawer-target "ghost-form" does not resolve to a registered screen/,
    );
  });

  test("params pick a field the target actionForm declares → no throw", () => {
    expect(() => validateBoot([makeFeature({ params: { pick: ["qty"] } })])).not.toThrow();
  });

  test("params pick a field the target actionForm does not declare → throw", () => {
    expect(() => validateBoot([makeFeature({ params: { pick: ["nope"] } })])).toThrow(
      /rowAction "open-drawer" params prefills "nope", which drawer-target "restock-form" does not declare as a field/,
    );
  });

  test("params map to a target key the actionForm does not declare → throw", () => {
    expect(() => validateBoot([makeFeature({ params: { map: { nope: "productQty" } } })])).toThrow(
      /params prefills "nope", which drawer-target "restock-form" does not declare/,
    );
  });

  test("params prefill a sensitive target field → throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          params: { pick: ["secret"] },
          targetFields: { secret: { type: "text", sensitive: true } },
          layoutFields: ["secret"],
        }),
      ]),
    ).toThrow(/params prefills "secret", which drawer-target "restock-form" marks as sensitive/);
  });

  test("params prefill a password-format target field → throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          params: { pick: ["pw"] },
          targetFields: { pw: { type: "text", format: "password" } },
          layoutFields: ["pw"],
        }),
      ]),
    ).toThrow(/params prefills "pw", which drawer-target "restock-form" marks as sensitive/);
  });

  test("params prefill a declared field the target layout does not render → throw", () => {
    expect(() =>
      validateBoot([
        makeFeature({
          params: { pick: ["hidden"] },
          targetFields: { qty: { type: "number" }, hidden: { type: "text" } },
          layoutFields: ["qty"],
        }),
      ]),
    ).toThrow(/params prefills "hidden", which drawer-target "restock-form" does not render/);
  });

  test("params map to a declared target key → no throw", () => {
    expect(() =>
      validateBoot([makeFeature({ params: { map: { qty: "productQty" } } })]),
    ).not.toThrow();
  });
});
