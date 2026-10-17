// Two custom writes racing one aggregate through ctx.unsafeAppendEvent (same core as appendEvent): the loser's
// 409 carries the winner's stream version, so a client can rebase.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
import { loadAggregate } from "../../event-store/index.js";
import { TestUsers } from "../../seeding/seed-users.js";

const AGGREGATE_TYPE = "avcDoc";
const WRITERS_PER_ROUND = 2;

const arrivals = new Map<string, { count: number; release: () => void; gate: Promise<void> }>();

// Holds each writer until all have arrived so their version reads overlap. The read sits after the
// barrier, so a round can still serialize cleanly; the test needs a conflict in some round, not each.
async function waitForAllWriters(aggregateId: string): Promise<void> {
  let entry = arrivals.get(aggregateId);
  if (!entry) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    entry = { count: 0, release, gate };
    arrivals.set(aggregateId, entry);
  }
  entry.count++;
  if (entry.count >= WRITERS_PER_ROUND) entry.release();
  await entry.gate;
}

const feature = defineFeature("avc", (r) => {
  const appended = r.defineEvent("appended", z.object({ note: z.string() }), {
    piiFields: "none",
  });
  r.writeHandler({
    name: "doc:append",
    schema: z.object({ aggregateId: z.uuid(), note: z.string() }),
    handler: async (event, ctx) => {
      await waitForAllWriters(event.payload.aggregateId);
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.aggregateId,
        aggregateType: AGGREGATE_TYPE,
        type: appended.name,
        payload: { note: event.payload.note },
      });
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

type ErrorBody = { error: { code: string; details: Record<string, unknown> } };

describe("ctx.unsafeAppendEvent version conflict", () => {
  test("the losing writer's 409 carries the winner's stream version", async () => {
    let conflicts = 0;
    for (let round = 0; round < 20; round++) {
      const aggregateId = crypto.randomUUID();
      const responses = await Promise.all(
        Array.from({ length: WRITERS_PER_ROUND }, (_, n) =>
          stack.http.write("avc:write:doc:append", { aggregateId, note: `w${n}` }, admin),
        ),
      );
      for (const res of responses) {
        if (res.status === 200) continue;
        expect(res.status).toBe(409);
        const body = (await res.json()) as ErrorBody;
        expect(body.error.code).toBe("version_conflict");
        expect(body.error.details).toMatchObject({ expectedVersion: 0, currentVersion: 1 });
        conflicts++;
      }
      const succeeded = responses.filter((res) => res.status === 200).length;
      expect(await loadAggregate(stack.db, aggregateId, admin.tenantId)).toHaveLength(succeeded);
    }
    expect(conflicts).toBeGreaterThan(0);
  });
});
