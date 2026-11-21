import { describe, expect, test } from "bun:test";
import { resolveAgentExposure } from "@cosmicdrift/kumiko-types/agent-exposure";
import type { WriteHandlerDefinition } from "@cosmicdrift/kumiko-types/define-handler";
import type { FeatureRegistrar } from "@cosmicdrift/kumiko-types/feature-registrar";
import * as z from "zod";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import {
  createEntity,
  createReferenceField,
  createSelectField,
  createTextField,
} from "../../factories.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { validateHandlerAccess, validateReferenceFields } from "../entity-handler.ts";
import { validateEntitySelectAvailabilityQuery } from "../entity-select.ts";
import { validateListSortAndSummary } from "../list-sort-summary.ts";
import { buildQueryHandlerMap } from "../projection-list-screens.ts";
import { validateQueryRefs } from "../query-refs.ts";

type HandlerOverrides = Partial<
  Pick<WriteHandlerDefinition, "access" | "rateLimit" | "agent" | "tenantlessAnonymous">
>;

function featureWith(overrides: HandlerOverrides) {
  return defineFeature("feature", (r) => {
    r.writeHandler({
      name: "name",
      schema: z.object({ topic: z.string() }),
      access: { roles: ["User"] },
      dispatchOnly: true,
      handler: async () => ({ isSuccess: true as const, data: {} }),
      ...overrides,
    });
  });
}

describe("validateHandlerAccess — dispatchOnly", () => {
  test("a dispatchOnly write with role access boots", () => {
    expect(() => validateHandlerAccess(featureWith({}))).not.toThrow();
  });

  test("dispatchOnly with agent.expose: true is rejected", () => {
    expect(() => validateHandlerAccess(featureWith({ agent: { expose: true } }))).toThrow(
      /dispatch-only-agent-exposed|feature:write:name/,
    );
  });

  test("dispatchOnly with tenantlessAnonymous is rejected", () => {
    const feature = featureWith({
      access: { roles: ["anonymous"] },
      rateLimit: { per: "ip", limit: 5, windowSeconds: 60 },
      tenantlessAnonymous: true,
    });
    expect(() => validateHandlerAccess(feature)).toThrow(
      /dispatch-only-tenantless|feature:write:name/,
    );
  });

  test("a dispatchOnly query with agent.expose: true is rejected", () => {
    const feature = defineFeature("feature", (r) => {
      r.queryHandler({
        name: "lookup",
        schema: z.object({}),
        access: { roles: ["User"] },
        dispatchOnly: true,
        agent: { expose: true },
        handler: async () => ({}),
      });
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/feature:query:lookup/);
  });
});

function featureWithScreenQuery(dispatchOnly: boolean) {
  return defineFeature("feature", (r) => {
    r.queryHandler({
      name: "rows",
      schema: z.object({}),
      access: { roles: ["User"] },
      dispatchOnly,
      handler: async () => ({ rows: [], nextCursor: null }),
    });
    r.screen({
      id: "row-list",
      type: "projectionList",
      query: "feature:query:rows",
      columns: ["title"],
    });
  });
}

describe("validateQueryRefs — dispatchOnly", () => {
  test("a screen loading a dispatchOnly query is rejected", () => {
    expect(() => validateQueryRefs([featureWithScreenQuery(true)])).toThrow(
      /\[Feature feature\] Screen "row-list" \(projectionList\) query "feature:query:rows" is dispatchOnly/,
    );
  });

  test("a screen loading a regular query boots", () => {
    expect(() => validateQueryRefs([featureWithScreenQuery(false)])).not.toThrow();
  });
});

describe("resolveAgentExposure — dispatchOnly", () => {
  test("a dispatchOnly handler is never exposed, even with a description", () => {
    expect(resolveAgentExposure({ description: "x", dispatchOnly: true }, "write").expose).toBe(
      false,
    );
  });

  test("the same handler without dispatchOnly is exposed", () => {
    expect(resolveAgentExposure({ description: "x" }, "write").expose).toBe(true);
  });
});

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const DISPATCH_ONLY_MESSAGE = /is dispatchOnly, so the browser can never load it/;

function textField() {
  return createTextField({ personal: false, reason: "test_fixture" });
}

type CustomerQueries = {
  readonly listDispatchOnly?: boolean;
  readonly optionsDispatchOnly?: boolean;
};

function customerQueries(r: FeatureRegistrar, queries: CustomerQueries): void {
  r.queryHandler({
    name: "customer:list",
    schema: z.object({}),
    access: OPEN_TO_ALL,
    ...(queries.listDispatchOnly === true && { dispatchOnly: true }),
    handler: async () => ({ rows: [], nextCursor: null }),
  });
  r.queryHandler({
    name: "customer-options",
    schema: z.object({}),
    access: OPEN_TO_ALL,
    ...(queries.optionsDispatchOnly === true && { dispatchOnly: true }),
    handler: async () => ({ rows: [], nextCursor: null }),
  });
}

function referenceFeature(queries: CustomerQueries) {
  return defineFeature("shop", (r) => {
    r.entity(
      createEntity({ name: "customer", table: "do_customers", fields: { name: textField() } }),
    );
    r.entity(
      createEntity({
        name: "order",
        table: "do_orders",
        fields: {
          customerId: createReferenceField({
            entity: "customer",
            personal: false,
            reason: "test_fixture",
            optionsQuery: "shop:query:customer-options",
          }),
        },
      }),
    );
    customerQueries(r, queries);
  });
}

function validateReferences(feature: FeatureDefinition): void {
  validateReferenceFields(
    feature,
    new Map([[feature.name, feature]]),
    buildQueryHandlerMap([feature]),
  );
}

describe("dispatchOnly query references the browser loads outside checkQueryRef", () => {
  test("a reference optionsQuery that is dispatchOnly is rejected", () => {
    expect(() => validateReferences(referenceFeature({ optionsDispatchOnly: true }))).toThrow(
      /Reference field "customerId" on entity "order" optionsQuery query "shop:query:customer-options" is dispatchOnly/,
    );
  });

  test("a reference whose target list query is dispatchOnly is rejected", () => {
    expect(() => validateReferences(referenceFeature({ listDispatchOnly: true }))).toThrow(
      /target list query "shop:query:customer:list" is dispatchOnly/,
    );
  });

  test("a reference with regular queries boots", () => {
    expect(() => validateReferences(referenceFeature({}))).not.toThrow();
  });

  test("an entity select optionsAvailabilityQuery that is dispatchOnly is rejected", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        createEntity({
          name: "order",
          table: "do_select_orders",
          fields: {
            size: createSelectField({
              options: ["small", "large"],
              optionsAvailabilityQuery: "shop:query:customer-options",
            }),
          },
        }),
      );
      customerQueries(r, { optionsDispatchOnly: true });
    });
    expect(() =>
      validateEntitySelectAvailabilityQuery(feature, buildQueryHandlerMap([feature])),
    ).toThrow(/select field "size" on entity "order" optionsAvailabilityQuery query/);
  });

  test("a table.summaryRow query that is dispatchOnly is rejected", () => {
    const feature = defineFeature("shop", (r) => {
      r.queryHandler({
        name: "order:list",
        schema: z.object({}),
        access: OPEN_TO_ALL,
        handler: async () => ({ rows: [], nextCursor: null }),
      });
      r.queryHandler({
        name: "order:summary",
        schema: z.object({}),
        access: OPEN_TO_ALL,
        dispatchOnly: true,
        handler: async () => ({ items: [] }),
      });
      r.screen({
        id: "orders",
        type: "projectionList",
        query: "shop:query:order:list",
        columns: ["number"],
        table: { summaryRow: { query: "shop:query:order:summary" } },
      });
    });
    expect(() => validateListSortAndSummary([feature])).toThrow(
      /table\.summaryRow query "shop:query:order:summary" is dispatchOnly/,
    );
  });

  test("a reference field on an actionForm whose optionsQuery is dispatchOnly is rejected", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        createEntity({
          name: "customer",
          table: "do_form_customers",
          fields: { name: textField() },
        }),
      );
      customerQueries(r, { optionsDispatchOnly: true });
      r.writeHandler({
        name: "assign",
        schema: z.object({ customerId: z.string() }),
        access: OPEN_TO_ALL,
        handler: async () => ({ isSuccess: true as const, data: {} }),
      });
      r.screen({
        id: "assign",
        type: "actionForm",
        handler: "shop:write:assign",
        fields: {
          customerId: createReferenceField({
            entity: "customer",
            personal: false,
            reason: "test_fixture",
            optionsQuery: "shop:query:customer-options",
          }),
        },
        layout: { sections: [{ fields: ["customerId"] }] },
      });
    });
    expect(() => validateQueryRefs([feature])).toThrow(
      /\(actionForm\) reference field "customerId" optionsQuery query "shop:query:customer-options" is dispatchOnly/,
    );
  });

  test("a reference facet whose target list query is dispatchOnly fails boot", () => {
    const feature = defineFeature("ledger", (r) => {
      r.entity(createEntity({ name: "tenant", table: "Tenants", fields: { name: textField() } }));
      r.queryHandler({
        name: "tenant:list",
        schema: z.object({}),
        access: OPEN_TO_ALL,
        dispatchOnly: true,
        handler: async () => ({ rows: [], nextCursor: null }),
      });
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ filters: z.unknown().optional() }),
        access: OPEN_TO_ALL,
        handler: async () => ({ rows: [], nextCursor: null }),
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["tenant"],
        facets: [{ field: "tenant", type: "reference", label: "Tenant", entity: "tenant" }],
      });
      r.translations({
        keys: {
          "screen:schedule-list.title": { de: "Liste", en: "List" },
          "ledger:entity:tenant:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(DISPATCH_ONLY_MESSAGE);
  });
});

describe("entityList screen and its implicit list query", () => {
  test("an entityList whose <entity>:list query is dispatchOnly is rejected", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        createEntity({ name: "order", table: "do_list_orders", fields: { name: textField() } }),
      );
      r.queryHandler({
        name: "order:list",
        schema: z.object({}),
        access: OPEN_TO_ALL,
        dispatchOnly: true,
        handler: async () => ({ rows: [], nextCursor: null }),
      });
      r.screen({ id: "orders", type: "entityList", entity: "order", columns: ["name"] });
    });
    expect(() => validateQueryRefs([feature])).toThrow(
      /Screen "orders" \(entityList\) query "shop:query:order:list" is dispatchOnly/,
    );
  });
});

describe("entityEdit screen and its implicit detail query", () => {
  function editFeature(detailDispatchOnly: boolean) {
    return defineFeature("shop", (r) => {
      r.entity(
        createEntity({ name: "order", table: "do_edit_orders", fields: { name: textField() } }),
      );
      r.queryHandler({
        name: "order:detail",
        schema: z.object({ id: z.string() }),
        access: OPEN_TO_ALL,
        ...(detailDispatchOnly && { dispatchOnly: true }),
        handler: async () => ({}),
      });
      r.screen({
        id: "order-edit",
        type: "entityEdit",
        entity: "order",
        layout: { sections: [{ fields: ["name"] }] },
      });
    });
  }

  test("an entityEdit whose <entity>:detail query is dispatchOnly is rejected", () => {
    expect(() => validateQueryRefs([editFeature(true)])).toThrow(
      /Screen "order-edit" \(entityEdit\) query "shop:query:order:detail" is dispatchOnly/,
    );
  });

  test("an entityEdit with a regular detail query boots", () => {
    expect(() => validateQueryRefs([editFeature(false)])).not.toThrow();
  });
});
