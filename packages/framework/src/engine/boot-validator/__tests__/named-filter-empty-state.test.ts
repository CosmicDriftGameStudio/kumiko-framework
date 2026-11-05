import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { BootValidationError } from "../boot-rule.ts";

function ruleIdsOf(features: Parameters<typeof validateBootRaw>[0]): readonly string[] {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  return [];
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function featureWith(emptyState: Record<string, unknown>) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:list",
      schema: z.object({ namedFilter: z.string().optional() }),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_TO_ALL,
    });
    r.queryHandler({
      name: "order:next-due",
      schema: z.object({}),
      handler: async () => ({ name: "Meier" }),
      access: OPEN_TO_ALL,
    });
    r.screen({
      id: "orders",
      type: "projectionList",
      query: "shop:query:order:list",
      columns: ["name"],
      namedFilters: [{ id: "due", label: "Due", emptyState }],
    } as never);
  });
}

describe("named filter emptyState.paramsQuery", () => {
  test("a registered query with a description boots", () => {
    const feature = featureWith({
      title: "t",
      description: "d",
      paramsQuery: "shop:query:order:next-due",
    });
    expect(ruleIdsOf([feature])).toEqual([]);
  });

  test("an empty paramsQuery is rejected", () => {
    const feature = featureWith({ title: "t", description: "d", paramsQuery: "" });
    expect(ruleIdsOf([feature])).toContain("list/named-filter-empty-state-params-query-empty");
  });

  test("an unregistered paramsQuery is query/not-registered", () => {
    const feature = featureWith({ title: "t", description: "d", paramsQuery: "shop:query:ghost" });
    expect(ruleIdsOf([feature])).toContain("query/not-registered");
  });

  test("paramsQuery without a description is rejected", () => {
    const feature = featureWith({ title: "t", paramsQuery: "shop:query:order:next-due" });
    expect(ruleIdsOf([feature])).toContain(
      "list/named-filter-empty-state-params-query-without-description",
    );
  });
});
