import { describe, expect, test } from "bun:test";
import type { HandlerDispatch } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { failNotFound } from "../../errors/index.ts";
import { createRegistry, defineFeature } from "../index.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const feature = defineFeature("orderDesk", (r) => ({
  totalQuery: r.queryHandler({
    name: "orderTotal",
    schema: z.object({ id: z.string() }),
    handler: async (query) => ({ id: query.payload.id, totalCents: 4200 }),
    access: { roles: ["Admin"] },
  }),
}));

const failingFeature = defineFeature("orderLookup", (r) => ({
  findQuery: r.queryHandler({
    name: "find",
    schema: z.object({ id: z.string() }),
    handler: async (query) => {
      if (query.payload.id === "missing") return failNotFound("order", query.payload.id);
      return { id: query.payload.id };
    },
    access: { roles: ["Admin"] },
  }),
}));

const callTotal = (d: Pick<HandlerDispatch, "query">) =>
  d.query(feature.exports.totalQuery, { id: "x" });

const callFind = (d: Pick<HandlerDispatch, "query">) =>
  d.query(failingFeature.exports.findQuery, { id: "x" });

const _wrongPayload = (d: Pick<HandlerDispatch, "query">) => {
  // @ts-expect-error payload id must be a string
  return d.query(feature.exports.totalQuery, { id: 1 });
};

export type _QueryHandlerRefTypeAssertions = [
  Expect<Equal<Awaited<ReturnType<typeof callTotal>>, { id: string; totalCents: number }>>,
  Expect<Equal<Awaited<ReturnType<typeof callFind>>, { id: string }>>,
  typeof _wrongPayload,
];

describe("query handler ref", () => {
  test("is a query contract whose qualifiedName matches the registry key, kebab-cased", () => {
    const ref = feature.exports.totalQuery;
    expect(ref.qualifiedName).toBe("order-desk:query:order-total");
    expect(ref.kind).toBe("query");
    expect(ref.name).toBe("orderTotal");
    expect(createRegistry([feature]).getQueryHandler(ref.qualifiedName)).toBeDefined();
  });
});
