import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { queryContract } from "@cosmicdrift/kumiko-types/handler-contract";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

type EchoPayload = { readonly value: string };
type EchoResult = { readonly echoed: string };

const echoContract = queryContract<EchoPayload, EchoResult>("contract-probe:query:echo");

const probeFeature = defineFeature("contract-probe", (r) => {
  r.queryHandler({
    name: "echo",
    schema: z.object({ value: z.string() }),
    access: { roles: ["Admin"] },
    handler: async (query) => ({ echoed: query.payload.value }),
  });
  r.writeHandler({
    name: "relay",
    schema: z.object({ value: z.string(), viaString: z.boolean() }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const { value, viaString } = event.payload;
      const echoed = viaString
        ? await ctx.dispatch.query("contract-probe:query:echo", { value })
        : await ctx.dispatch.query(echoContract, { value });
      return { isSuccess: true as const, data: echoed };
    },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [probeFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("ctx.dispatch.query with a handler contract", () => {
  test("a nested query through the contract returns the handler result", async () => {
    const data = await stack.http.writeOk<EchoResult>(
      "contract-probe:write:relay",
      { value: "x", viaString: false },
      admin,
    );
    expect(data).toEqual({ echoed: "x" });
  });

  test("the string form of the same handler returns the same result", async () => {
    const data = await stack.http.writeOk<EchoResult>(
      "contract-probe:write:relay",
      { value: "x", viaString: true },
      admin,
    );
    expect(data).toEqual({ echoed: "x" });
  });
});
