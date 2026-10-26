// r.job trigger { catchUp: true } — the job gets its own event consumer
// (job:<jobQn>, cursor from the beginning) and a deterministic job id per event.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { selectMany } from "../../db/query.ts";
import { defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";
import { eventConsumerStateTable } from "../event-consumer-state.ts";

const CATCH_UP_JOB_QN = "catch-up-fixture:job:on-ping-catch-up";
const CATCH_UP_CONSUMER_NAME = `job:${CATCH_UP_JOB_QN}`;

const catchUpRuns: string[] = [];
const plainRuns: string[] = [];

const catchUpFixtureFeature = defineFeature("catch-up-fixture", (r) => {
  const ping = r.defineEvent("ping", z.object({ pingId: z.uuid() }), { piiFields: "none" });

  r.writeHandler({
    name: "emit-ping",
    schema: z.object({ pingId: z.uuid() }),
    handler: async (cmd, ctx) => {
      await ctx.events.unsafeAppend({
        aggregateId: cmd.payload.pingId,
        aggregateType: "ping",
        type: ping.name,
        payload: cmd.payload,
      });
      return { isSuccess: true, data: { kind: "save", id: cmd.payload.pingId } };
    },
    access: { roles: ["Admin"] },
  });

  r.job(
    "on-ping-catch-up",
    { trigger: { on: ping.name, catchUp: true }, runIn: "worker" },
    async (payload) => {
      catchUpRuns.push(payload["pingId"] as string);
    },
  );
  r.job("on-ping-plain", { trigger: { on: ping.name }, runIn: "worker" }, async (payload) => {
    plainRuns.push(payload["pingId"] as string);
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [catchUpFixtureFeature],
    jobs: { consumerLane: "worker", queueNamePrefix: `catch-up-fixture-${generateId()}` },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function emitPing(): Promise<string> {
  const pingId = generateId();
  const res = await stack.http.write(
    "catch-up-fixture:write:emit-ping",
    { pingId },
    TestUsers.admin,
  );
  expect(res.status).toBe(200);
  return pingId;
}

describe("r.job trigger.catchUp", () => {
  test("runs once per stored event, including events appended before any dispatcher pass", async () => {
    const early = [await emitPing(), await emitPing(), await emitPing()];

    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      expect(catchUpRuns.slice().sort()).toEqual(early.slice().sort());
    });

    const late = await emitPing();
    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      expect(catchUpRuns).toContain(late);
    });
    await stack.drainJobs();

    // The shared job-trigger consumer also saw every event and must not have enqueued the job again.
    expect(catchUpRuns).toHaveLength(4);
    expect(catchUpRuns.slice().sort()).toEqual([...early, late].sort());
    expect(plainRuns).toHaveLength(4);
  });

  test("the job owns a consumer cursor named after its job QN", async () => {
    const rows = await selectMany(stack.db, eventConsumerStateTable, {
      name: CATCH_UP_CONSUMER_NAME,
    });
    expect(rows).toHaveLength(1);
  });

  test("a redelivered event does not enqueue the job a second time", async () => {
    const runner = stack.jobRunner;
    if (!runner) throw new Error("test stack has no job runner");
    const before = catchUpRuns.length;
    const pingId = generateId();
    const user = { id: TestUsers.admin.id, tenantId: TestUsers.admin.tenantId, roles: [] };
    const triggerEvent = { id: generateId(), headers: {} };

    await runner.handleCatchUpEvent(
      CATCH_UP_JOB_QN,
      "catch-up-fixture:event:ping",
      { pingId },
      user,
      triggerEvent,
    );
    await runner.handleCatchUpEvent(
      CATCH_UP_JOB_QN,
      "catch-up-fixture:event:ping",
      { pingId },
      user,
      triggerEvent,
    );
    await stack.drainJobs();

    expect(catchUpRuns.slice(before)).toEqual([pingId]);
  });
});

describe("r.job trigger.catchUp boot validation", () => {
  test("rejects a handler QN as trigger target", async () => {
    const broken = defineFeature("catch-up-broken", (r) => {
      r.writeHandler({
        name: "do-it",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true, data: { kind: "save", id: generateId() } }),
        access: { roles: ["Admin"] },
      });
      r.job(
        "replay-handler",
        { trigger: { on: "catch-up-broken:write:do-it", catchUp: true } },
        async () => {},
      );
    });
    await expect(setupTestStack({ features: [broken] })).rejects.toThrow(/catchUp/);
  });
});
