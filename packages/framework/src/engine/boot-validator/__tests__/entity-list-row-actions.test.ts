import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createDerivedField, createEntity, createTextField } from "../../factories.ts";
import { from } from "../../ownership.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  describe("clientAction row actions", () => {
    function orderQuery(r: Parameters<Parameters<typeof defineFeature>[1]>[0]): void {
      r.queryHandler({
        name: "orders",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
    }

    function listWithClientAction(action: string) {
      return defineFeature("shop", (r) => {
        orderQuery(r);
        r.screen({
          id: "order-list",
          type: "projectionList",
          query: "shop:query:orders",
          columns: [{ field: "name", label: "shop:col:name" }],
          rowActions: [{ kind: "clientAction", id: "send", label: "shop:action:send", action }],
        });
      });
    }

    test("accepts <feature>:<kebab>", () => {
      expect(() =>
        validateBoot([listWithClientAction("auth-email-password:request-password-reset")]),
      ).not.toThrow();
    });

    test.each(["resetPassword", "shop:", "shop:Reset", "a:b:c", "reset"])(
      "rejects the malformed name %s",
      (name) => {
        expect(() => validateBoot([listWithClientAction(name)])).toThrow(
          /is not a client action name — expected "<feature>:<kebab-name>"/,
        );
      },
    );

    test("projectionDetail header action is checked too", () => {
      const feature = defineFeature("shop", (r) => {
        r.queryHandler({
          name: "order-detail",
          schema: z.object({}),
          handler: async () => ({ id: "o1" }),
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order-detail",
          layout: { sections: [{ fields: ["total"] }] },
          actions: [
            { kind: "clientAction", id: "send", label: "shop:action:send", action: "Not Valid" },
          ],
        });
      });
      expect(() => validateBoot([feature])).toThrow(/action "send" action "Not Valid"/);
    });
  });

  describe("entityList rowAction rowClick", () => {
    function makeFeature(rowClickCount: number) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.screen({ id: "product-editor", type: "custom", renderer: { react: "stub" } });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: Array.from({ length: rowClickCount }, (_, i) => ({
            kind: "navigate" as const,
            id: `open-${i}`,
            label: "actions.edit",
            screen: "product-editor",
            rowClick: true,
          })),
        });
      });
    }

    test("one rowClick navigate action passes boot", () => {
      expect(() => validateBoot([makeFeature(1)])).not.toThrow();
    });

    test("more than one rowClick action per list is rejected", () => {
      expect(() => validateBoot([makeFeature(2)])).toThrow(
        /at most one may fire on a row-body click/i,
      );
    });
  });

  describe("entityList rowAction kind=writeHandler handler-QN", () => {
    function makeFeature(handlerQn: string, register: boolean) {
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
          columns: ["name"],
          rowActions: [{ id: "delete", label: "actions.delete", handler: handlerQn }],
        });
        if (register) {
          r.writeHandler({
            name: "delete",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true as const, data: null }),
            access: { roles: ["Admin"] },
          });
        }
      });
    }

    test("handler → registered → no throw", () => {
      expect(() => validateBoot([makeFeature("shop:write:delete", true)])).not.toThrow();
    });

    test("handler → not registered → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature("shop:write:ghost", false)])).toThrow(
        /rowAction "delete" .*handler "shop:write:ghost" is not a registered write-handler/,
      );
    });
  });

  // Row metadata (id, version) is present on every entity row without being an
  // entity field — pick ["id", "version"] is the standard payload
  // for optimistic-lock lifecycle writes and must not break boot
  // (production incident: the 0.40 validator rejected
  // maintenance-start/cancel/complete, causing CrashLoopBackOff).
  describe("entityList rowAction payload pick", () => {
    function makeFeature(pick: readonly string[]) {
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
          columns: ["name"],
          rowActions: [
            {
              id: "archive",
              label: "actions.archive",
              handler: "shop:write:archive",
              payload: { pick: [...pick] },
            },
          ],
        });
        r.writeHandler({
          name: "archive",
          schema: z.object({}),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
      });
    }

    test("pick with row metadata id + version → no throw (optimistic-lock standard)", () => {
      expect(() => validateBoot([makeFeature(["id", "version"])])).not.toThrow();
    });

    test("pick with an entity field → no throw", () => {
      expect(() => validateBoot([makeFeature(["id", "name"])])).not.toThrow();
    });

    test("pick with an unknown field → throws with a clear message", () => {
      expect(() => validateBoot([makeFeature(["id", "ghost"])])).toThrow(
        /rowAction "archive" payload references unknown field "ghost"/,
      );
    });
  });

  // `buildBaseColumns` adds `tenantId`/`insertedAt`/`modifiedAt` and other base
  // columns to every row, so using them in pick/map/visible is valid. Soft-delete
  // columns (`isDeleted`/...) exist only on soft-delete entities and must still
  // fail validation when absent.
  describe("entityList rowAction row-meta allowlist", () => {
    function makeFeature(opts: {
      pick?: readonly string[];
      map?: Record<string, string>;
      visibleField?: string;
      softDelete?: boolean;
    }) {
      return defineFeature("shop", (r) => {
        r.entity({
          name: "product",
          ...createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
            softDelete: opts.softDelete ?? false,
            derivedFields: {
              archivable: createDerivedField({
                valueType: "boolean",
                derive: (row) => row["name"] !== "",
              }),
              displayName: createDerivedField({
                valueType: "text",
                sql: { kind: "coalesce", fields: ["name"] },
              }),
            },
          }),
        });
        r.screen({
          id: "product-list",
          type: "entityList",
          entity: "product",
          columns: ["name"],
          rowActions: [
            {
              id: "archive",
              label: "actions.archive",
              handler: "shop:write:archive",
              ...(opts.pick ? { payload: { pick: [...opts.pick] } } : {}),
              ...(opts.map ? { payload: { map: { ...opts.map } } } : {}),
              ...(opts.visibleField ? { visible: { field: opts.visibleField, eq: true } } : {}),
            },
          ],
        });
        r.writeHandler({
          name: "archive",
          schema: z.object({}),
          handler: async () => ({ isSuccess: true as const, data: null }),
          access: { roles: ["Admin"] },
        });
      });
    }

    test("pick with base column tenantId → no throw", () => {
      expect(() => validateBoot([makeFeature({ pick: ["id", "tenantId"] })])).not.toThrow();
    });

    test("visible.field on row metadata (version) → no throw", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "version" })])).not.toThrow();
    });

    test("visible.field on id → no throw (aggregate id is always present)", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "id" })])).not.toThrow();
    });

    test("visible.field on unknown Field → Throw", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "ghost" })])).toThrow(
        /visible\.field references unknown field "ghost"/,
      );
    });

    test("visible.field on a JS derived field → no throw", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "archivable" })])).not.toThrow();
    });

    test("visible.field on a SQL derived field → no throw", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "displayName" })])).not.toThrow();
    });

    test("visible.field on an unknown field lists the derived fields as known", () => {
      expect(() => validateBoot([makeFeature({ visibleField: "ghost" })])).toThrow(
        /visible\.field references unknown field "ghost"\. Known fields: archivable, displayName, name\./,
      );
    });

    test("payload pick of a derived field → throws (derived values are display-only)", () => {
      expect(() => validateBoot([makeFeature({ pick: ["id", "archivable"] })])).toThrow(
        /payload references unknown field "archivable"/,
      );
    });

    test("map extractor with base column tenantId → no throw", () => {
      expect(() => validateBoot([makeFeature({ map: { target: "tenantId" } })])).not.toThrow();
    });

    test("map extractor with an unknown field → throws", () => {
      expect(() => validateBoot([makeFeature({ map: { target: "ghost" } })])).toThrow(
        /payload references unknown field "ghost"/,
      );
    });

    test("softDelete entity: pick isDeleted → no throw", () => {
      expect(() =>
        validateBoot([makeFeature({ pick: ["id", "isDeleted"], softDelete: true })]),
      ).not.toThrow();
    });

    test("non-softDelete entity: pick isDeleted → throws (column does not exist)", () => {
      expect(() =>
        validateBoot([makeFeature({ pick: ["id", "isDeleted"], softDelete: false })]),
      ).toThrow(/references unknown field "isDeleted"/);
    });
  });
