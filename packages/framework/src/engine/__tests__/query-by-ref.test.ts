import { describe, expect, test } from "bun:test";
import type { HandlerDispatch } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { createRegistry, defineFeature, queryByRef } from "../index.ts";

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

const callTotal = (d: Pick<HandlerDispatch, "query">) =>
  queryByRef(d, feature.exports.totalQuery, { id: "x" });

const _wrongPayload = (d: Pick<HandlerDispatch, "query">) => {
  // @ts-expect-error payload id must be a string
  return queryByRef(d, feature.exports.totalQuery, { id: 1 });
};

export type _QueryByRefTypeAssertions = [
  Expect<Equal<Awaited<ReturnType<typeof callTotal>>, { id: string; totalCents: number }>>,
  typeof _wrongPayload,
];

describe("queryByRef", () => {
  test("qualifiedName matches the registry key, kebab-cased", () => {
    expect(feature.exports.totalQuery.qualifiedName).toBe("order-desk:query:order-total");
    expect(
      createRegistry([feature]).getQueryHandler(feature.exports.totalQuery.qualifiedName),
    ).toBeDefined();
    expect(feature.exports.totalQuery.name).toBe("orderTotal");
  });

  test("queryByRef dispatches the qualified name and returns the handler result", async () => {
    const calls: { qn: string; payload: unknown }[] = [];
    const fake = {
      query: async (qn: string, payload: unknown) => {
        calls.push({ qn, payload });
        return { id: "o-1", totalCents: 4200 };
      },
    };
    const total = await queryByRef(fake, feature.exports.totalQuery, { id: "o-1" });
    expect(total.totalCents).toBe(4200);
    expect(calls).toEqual([{ qn: "order-desk:query:order-total", payload: { id: "o-1" } }]);
  });
});
