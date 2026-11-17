import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const orderDesk = defineFeature("orderDesk", (r) => ({
  totalQuery: r.queryHandler({
    name: "orderTotal",
    schema: z.object({ id: z.string() }),
    handler: async (query) => ({ id: query.payload.id, totalCents: 4200 }),
    access: { roles: ["Admin"] },
  }),
}));

const reporting = defineFeature("reporting", (r) => {
  r.queryHandler({
    name: "summary",
    schema: z.object({ id: z.string() }),
    handler: async (query, ctx) => {
      const total = await ctx.dispatch.query(orderDesk.exports.totalQuery, {
        id: query.payload.id,
      });
      return { label: `${total.id}: ${total.totalCents}` };
    },
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [orderDesk, reporting] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("query handler ref", () => {
  test("a handler reads another feature's query through its typed ref over HTTP", async () => {
    const data = await stack.http.queryOk<{ label: string }>(
      "reporting:query:summary",
      { id: "o-1" },
      TestUsers.admin,
    );
    expect(data.label).toBe("o-1: 4200");
  });
});
