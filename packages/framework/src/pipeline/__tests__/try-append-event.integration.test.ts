// Issue #1038 — ctx.tryAppendEvent (savepoint-scoped append).
//
// Claims pinned here:
//   1. Happy path: first append on a fresh aggregate succeeds, returns
//      { ok: true, event } with the stored event.
//   2. Non-poisoning: when tryAppendEvent loses a version-conflict race, the
//      rest of the handler's transaction still commits (a write AFTER the
//      call in the same handler is not rolled back) — this is the whole
//      reason the primitive exists over a bare try/catch around
//      unsafeAppendEvent (Bun.SQL/postgres.js abort the entire begin() on
//      an uncaught statement error, SQLSTATE 25P02, even if the JS error is
//      caught).
//
// The conflict branch can't be forced deterministically through the public
// interface — appendDomainEventCore reads the stream version fresh inside
// itself, so a lone sequential append never conflicts; only two concurrent
// transactions racing the same version produce the 23505. So claim 2 is
// tested as an invariant over concurrent writers (looped per house
// convention for probabilistic tests) rather than by asserting the conflict
// branch was hit on a specific call — depending on interleaving, Postgres
// may pick either writer as the winner.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { loadAggregate } from "../../event-store";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";

const TAE_AGGREGATE_TYPE = "taeDoc";

// Marker entity — a plain CRUD write issued right after ctx.tryAppendEvent
// in the same handler/transaction. Its row landing (regardless of whether
// the append won or lost the race) is the non-poisoning proof.
const markerEntity = createEntity({
  table: "tae_markers",
  fields: {
    note: createTextField({ required: true }),
  },
});
const markerTable = buildEntityTable("taeMarker", markerEntity);
const markerExecutor = createEventStoreExecutor(markerTable, markerEntity, {
  entityName: "taeMarker",
});

let stack: TestStack;
const admin = TestUsers.admin;

const tryAppendFeature = defineFeature("tae", (r) => {
  r.entity("taeMarker", markerEntity);
  const appended = r.defineEvent("appended", z.object({ note: z.string() }));

  r.writeHandler(
    "doc:try-append",
    z.object({ aggregateId: z.uuid(), note: z.string() }),
    async (event, ctx) => {
      const result = await ctx.tryAppendEvent({
        aggregateId: event.payload.aggregateId,
        aggregateType: TAE_AGGREGATE_TYPE,
        type: appended.name,
        payload: { note: event.payload.note },
      });
      // Runs unconditionally — if tryAppendEvent's savepoint failed to
      // confine the VersionConflictError, this write would fail too
      // because the whole tx aborted (25P02).
      const markerCreated = await markerExecutor.create(
        { note: event.payload.note },
        event.user,
        ctx.db,
      );
      if (!markerCreated.isSuccess) return markerCreated;
      return {
        isSuccess: true as const,
        data: {
          ok: result.ok,
          version: result.ok ? result.event.version : null,
        },
      };
    },
    { access: { roles: ["Admin"] } },
  );
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [tryAppendFeature] });
  await unsafeCreateEntityTable(stack.db, markerEntity, "taeMarker");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, "${markerTable.tableName}" RESTART IDENTITY CASCADE`,
  );
});

describe("Issue #1038 — ctx.tryAppendEvent", () => {
  test("happy path: first append on a fresh aggregate returns { ok: true, event }", async () => {
    const aggregateId = crypto.randomUUID();

    const result = await stack.http.writeOk<{
      ok: boolean;
      version: number | null;
    }>("tae:write:doc:try-append", { aggregateId, note: "hello" }, admin);

    expect(result.ok).toBe(true);
    expect(result.version).toBe(1);

    const events = await loadAggregate(stack.db, aggregateId, admin.tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ note: "hello" });

    const markers = await selectMany(stack.db, markerTable);
    expect(markers).toHaveLength(1);
  });

  // Probabilistic — looped per house convention (mehrere Durchläufe, z.B.
  // 20x) since a genuine 23505 race depends on transaction-timing
  // interleaving that a single run can't force deterministically.
  const ITERATIONS = 20;
  const CONCURRENCY = 3;

  test(`non-poisoning invariant holds across ${ITERATIONS} concurrent-writer rounds`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const aggregateId = crypto.randomUUID();

      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, n) =>
          stack.http.write("tae:write:doc:try-append", { aggregateId, note: `writer-${n}` }, admin),
        ),
      );

      // No writer's transaction was poisoned by a losing append — every
      // request completes as a normal 200, never a 500 from an aborted tx.
      let okCount = 0;
      for (const res of responses) {
        expect(res.status).toBe(200);
        const body = (await res.json()) as { isSuccess: boolean; data: { ok: boolean } };
        expect(body.isSuccess).toBe(true);
        if (body.data.ok) okCount++;
      }

      // One event per successful append — interleaving-independent
      // invariant. Serialized (non-racing) writers can legitimately all
      // succeed at different versions; only actual conflicts return
      // { ok: false }, so events.length must track okCount, not a fixed 1.
      const events = await loadAggregate(stack.db, aggregateId, admin.tenantId);
      expect(events).toHaveLength(okCount);
      expect(okCount).toBeGreaterThanOrEqual(1);

      // Every writer's marker insert landed regardless of win/lose — the
      // savepoint confined the losers' VersionConflictError instead of
      // aborting their whole transaction.
      const markers = await selectMany(stack.db, markerTable);
      expect(markers).toHaveLength(CONCURRENCY);

      await asRawClient(stack.db).unsafe(
        `TRUNCATE kumiko_events, "${markerTable.tableName}" RESTART IDENTITY CASCADE`,
      );
    }
  });
});
