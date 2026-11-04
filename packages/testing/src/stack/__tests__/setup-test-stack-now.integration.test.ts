import { afterEach, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { createManualClock } from "../../helpers/manual-clock.ts";
import { setupTestStack, type TestStack } from "../test-stack.ts";

const nowFeature = defineFeature("stnow", (r) => {
  r.writeHandler({
    name: "read-now",
    schema: z.object({}),
    handler: async (_event, ctx) => ({
      isSuccess: true as const,
      data: { now: ctx.tz.now().toString() },
    }),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

let stack: TestStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

describe("setupTestStack now option (integration)", () => {
  test("a string pins ctx.tz.now()", async () => {
    stack = await setupTestStack({ features: [nowFeature], now: "2031-05-06T07:08:09Z" });
    const res = await stack.http.writeOk<{ now: string }>(
      "stnow:write:read-now",
      {},
      TestUsers.admin,
    );
    expect(res.now).toBe("2031-05-06T07:08:09Z");
  });

  test("an Instant pins ctx.tz.now()", async () => {
    stack = await setupTestStack({
      features: [nowFeature],
      now: Temporal.Instant.from("2032-01-02T03:04:05Z"),
    });
    const res = await stack.http.writeOk<{ now: string }>(
      "stnow:write:read-now",
      {},
      TestUsers.admin,
    );
    expect(res.now).toBe("2032-01-02T03:04:05Z");
  });

  test("extraContext.clock wins over now", async () => {
    stack = await setupTestStack({
      features: [nowFeature],
      now: "2031-05-06T07:08:09Z",
      extraContext: { clock: createManualClock(Temporal.Instant.from("2040-09-09T09:09:09Z")) },
    });
    const res = await stack.http.writeOk<{ now: string }>(
      "stnow:write:read-now",
      {},
      TestUsers.admin,
    );
    expect(res.now).toBe("2040-09-09T09:09:09Z");
  });
});
