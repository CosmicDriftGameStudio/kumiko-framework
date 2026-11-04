import { afterEach, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { createManualClock } from "../../helpers/manual-clock.ts";
import { setupTestStack, type TestStack } from "../test-stack.ts";

const nowFeature = defineFeature("stnow", (r) => {
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    handler: async () => ({ ok: true }),
    access: { openToAll: { reason: "test query callable by any signed-in test user" } },
  });
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

  test("stack.clock is the manual clock behind ctx.tz.now()", async () => {
    stack = await setupTestStack({ features: [nowFeature], now: "2031-05-06T07:08:09Z" });
    stack.clock?.advance({ hours: 1 });
    const res = await stack.http.writeOk<{ now: string }>(
      "stnow:write:read-now",
      {},
      TestUsers.admin,
    );
    expect(res.now).toBe("2031-05-06T08:08:09Z");
  });

  test("query answers carry the pinned clock in x-kumiko-now", async () => {
    stack = await setupTestStack({ features: [nowFeature], now: "2031-05-06T07:08:09Z" });
    const res = await stack.http.query("stnow:query:ping", {}, TestUsers.admin);
    expect(res.headers.get("x-kumiko-now")).toBe("2031-05-06T07:08:09.000Z");
  });

  test("without now there is no stack.clock", async () => {
    stack = await setupTestStack({ features: [nowFeature] });
    expect(stack.clock).toBeUndefined();
  });

  test("an invalid now string fails with the option name", async () => {
    await expect(setupTestStack({ features: [nowFeature], now: "not-a-date" })).rejects.toThrow(
      /option "now" must be an ISO instant/,
    );
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
    expect(stack.clock?.now().toString()).toBe("2040-09-09T09:09:09Z");
  });
});
