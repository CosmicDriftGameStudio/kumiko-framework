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

// The stale writer reads the stream version, then waits until the test has committed another write
// to the same stream, so its own append is decided on an outdated read.
let staleReadDone = createBarrier({ expected: 2 });
let letStaleWriterAppend: () => void = () => {};
let staleWriterMayAppend = Promise.resolve();

function armStaleRound(): void {
  staleReadDone = createBarrier({ expected: 2 });
  staleWriterMayAppend = new Promise<void>((resolve) => {
    letStaleWriterAppend = resolve;
  });
}

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
        blindAppendReason: "both writers append an independent note; the unique index alone orders them",
      });
      if (event.payload.role === "first") {
        await firstAppended.arrive();
        await firstMayCommit;
      }
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "doc:pinned-append",
    schema: z.object({
      aggregateId: z.uuid(),
      note: z.string(),
      mode: z.enum(["pinned", "blind"]),
    }),
    handler: async (event, ctx) => {
      const version = await ctx.events.streamVersion(event.payload.aggregateId);
      await staleReadDone.arrive();
      await staleWriterMayAppend;
      const base = {
        aggregateId: event.payload.aggregateId,
        aggregateType: AGGREGATE_TYPE,
        type: appended.name,
        payload: { note: event.payload.note },
      };
      await ctx.events.unsafeAppend(
        event.payload.mode === "pinned"
          ? { ...base, expectedVersion: version }
          : {
              ...base,
              blindAppendReason:
                "the contrast case appends an independent note without looking at the stream it read",
            },
      );
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "doc:append-once",
    schema: z.object({ aggregateId: z.uuid(), note: z.string() }),
    handler: async (event, ctx) => {
      await ctx.events.unsafeAppend({
        aggregateId: event.payload.aggregateId,
        aggregateType: AGGREGATE_TYPE,
        expectedVersion: 0,
        type: appended.name,
        payload: { note: event.payload.note },
      });
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "doc:no-expectation",
    schema: z.object({ aggregateId: z.uuid() }),
    handler: async (event, ctx) => {
      // @ts-expect-error append without a concurrency expectation must not compile
      await ctx.events.unsafeAppend({
        aggregateId: event.payload.aggregateId,
        aggregateType: AGGREGATE_TYPE,
        type: appended.name,
        payload: { note: "no expectation" },
      });
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "doc:placeholder-reason",
    schema: z.object({ aggregateId: z.uuid() }),
    handler: async (event, ctx) => {
      await ctx.events.unsafeAppend({
        aggregateId: event.payload.aggregateId,
        aggregateType: AGGREGATE_TYPE,
        type: appended.name,
        payload: { note: "placeholder reason" },
        blindAppendReason: "todo",
      });
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "doc:negative-version",
    schema: z.object({ aggregateId: z.uuid() }),
    handler: async (event, ctx) => {
      await ctx.events.unsafeAppend({
        aggregateId: event.payload.aggregateId,
        aggregateType: AGGREGATE_TYPE,
        type: appended.name,
        payload: { note: "negative version" },
        expectedVersion: -1,
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

async function writersBlockedOnRowLock(): Promise<number> {
  const rows = await executeRawQuery<{ count: number }>(
    stack.db,
    `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND wait_event = 'transactionid'`,
  );
  return rows[0]?.count ?? 0;
}

describe("append concurrency contract", () => {
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

  async function staleWriterAfterCommittedWrite(mode: "pinned" | "blind") {
    armStaleRound();
    const aggregateId = crypto.randomUUID();
    const stale = stack.http.write(
      "avc:write:doc:pinned-append",
      { aggregateId, note: "stale", mode },
      admin,
    );
    await staleReadDone.arrive();
    await stack.http.writeOk("avc:write:doc:append-once", { aggregateId, note: "winner" }, admin);
    letStaleWriterAppend();
    return { aggregateId, response: await stale };
  }

  test("a pinned append fails with version_conflict when another write committed after the read", async () => {
    const { aggregateId, response } = await staleWriterAfterCommittedWrite("pinned");
    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("version_conflict");
    expect(body.error.details).toMatchObject({ expectedVersion: 0, currentVersion: 1 });
    expect(await loadAggregate(stack.db, aggregateId, admin.tenantId)).toHaveLength(1);
  });

  test("a blind append with a reason lands after the same interleaving", async () => {
    const { aggregateId, response } = await staleWriterAfterCommittedWrite("blind");
    expect(response.status).toBe(200);
    expect(await loadAggregate(stack.db, aggregateId, admin.tenantId)).toHaveLength(2);
  });

  test.each([
    ["an append without expectedVersion or blindAppendReason", "avc:write:doc:no-expectation"],
    ["a placeholder blindAppendReason", "avc:write:doc:placeholder-reason"],
    ["a negative expectedVersion", "avc:write:doc:negative-version"],
  ])("%s is rejected and appends nothing", async (_label, handlerQn) => {
    const aggregateId = crypto.randomUUID();
    const response = await stack.http.write(handlerQn, { aggregateId }, admin);
    expect(response.status).toBe(500);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("internal_error");
    expect(await loadAggregate(stack.db, aggregateId, admin.tenantId)).toHaveLength(0);
  });
});
