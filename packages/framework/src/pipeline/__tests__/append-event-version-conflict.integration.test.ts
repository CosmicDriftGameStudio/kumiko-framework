import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createBarrier, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { executeRawQuery } from "../../db/queries/raw-sql.ts";
import { defineFeature } from "../../engine/index.ts";
import { loadAggregate } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const AGGREGATE_TYPE = "avcDoc";

// The "first" writer appends and then holds its transaction open until released, so the "second"
// writer reads the stream at version 0 and its insert blocks on the first writer's uncommitted row.
let firstAppended = createBarrier({ expected: 2 });
let commitFirst: () => void = () => {};
let firstMayCommit = Promise.resolve();

function armRound(): void {
  firstAppended = createBarrier({ expected: 2 });
  firstMayCommit = new Promise<void>((resolve) => {
    commitFirst = resolve;
  });
}

const feature = defineFeature("avc", (r) => {
  const appended = r.defineEvent("appended", z.object({ note: z.string() }), {
    piiFields: "none",
  });
  r.writeHandler({
    name: "doc:append",
    schema: z.object({
      aggregateId: z.uuid(),
      note: z.string(),
      role: z.enum(["first", "second"]),
    }),
    handler: async (event, ctx) => {
      await ctx.events.unsafeAppend({
        aggregateId: event.payload.aggregateId,
        aggregateType: AGGREGATE_TYPE,
        type: appended.name,
        payload: { note: event.payload.note },
      });
      if (event.payload.role === "first") {
        await firstAppended.arrive();
        await firstMayCommit;
      }
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

async function writersBlockedOnRowLock(): Promise<number> {
  const rows = await executeRawQuery<{ count: number }>(
    stack.db,
    `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND wait_event = 'transactionid'`,
  );
  return rows[0]?.count ?? 0;
}

describe("ctx.events.unsafeAppend version conflict", () => {
  test.each([1, 2, 3])(
    "round %i: the losing writer's 409 carries the winner's stream version",
    async () => {
      armRound();
      const aggregateId = crypto.randomUUID();
      const write = (role: "first" | "second") =>
        stack.http.write("avc:write:doc:append", { aggregateId, note: role, role }, admin);

      const firstResponse = write("first");
      await firstAppended.arrive();
      const secondResponse = write("second");
      await waitFor(async () => (await writersBlockedOnRowLock()) > 0, {
        delays: Array.from({ length: 100 }, () => 50),
      });
      commitFirst();

      expect((await firstResponse).status).toBe(200);
      const loser = await secondResponse;
      expect(loser.status).toBe(409);
      const body = (await loser.json()) as ErrorBody;
      expect(body.error.code).toBe("version_conflict");
      expect(body.error.details).toMatchObject({ expectedVersion: 0, currentVersion: 1 });
      expect(await loadAggregate(stack.db, aggregateId, admin.tenantId)).toHaveLength(1);
    },
  );
});
