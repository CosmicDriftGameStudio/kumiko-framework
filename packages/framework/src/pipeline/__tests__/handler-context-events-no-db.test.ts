import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import { createTestUser } from "../../seeding/seed-users.ts";
import { createDispatcher } from "../dispatcher.ts";

const noDbFeature = defineFeature("nodb", (r) => {
  r.queryHandler({
    name: "load-aggregate",
    schema: z.object({}),
    handler: async (_query, ctx) => ctx.loadAggregate("agg-1"),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler({
    name: "is-stream-archived",
    schema: z.object({}),
    handler: async (_query, ctx) => ctx.isStreamArchived("agg-1"),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

async function rejectionMessage(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the query to reject");
}

describe("event store surfaces without a database connection", () => {
  const dispatcher = createDispatcher(createRegistry([noDbFeature]), {});

  test("ctx.loadAggregate names the call in the no-database error", async () => {
    const message = await rejectionMessage(
      dispatcher.query("nodb:query:load-aggregate", {}, createTestUser()),
    );
    expect(message).toBe(
      'ctx.loadAggregate("agg-1") requires a database connection — none is configured.',
    );
  });

  test("ctx.isStreamArchived names the call in the no-database error", async () => {
    const message = await rejectionMessage(
      dispatcher.query("nodb:query:is-stream-archived", {}, createTestUser()),
    );
    expect(message).toBe(
      'ctx.isStreamArchived("agg-1") requires a database connection — none is configured.',
    );
  });
});
