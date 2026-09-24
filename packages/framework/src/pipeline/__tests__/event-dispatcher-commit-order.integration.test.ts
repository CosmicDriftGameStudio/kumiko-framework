// kumiko_events.id is a bigserial: ids are assigned at INSERT time, before
// commit. Two concurrent writers can grab ids N and N+1 and commit out of
// order — if the N+1 transaction commits first, a plain `id > cursor` SELECT
// sees only N+1, delivers it, and would set cursor=N+1, permanently skipping
// N once its transaction commits afterwards (`id > cursor` never revisits
// it). event-dispatcher-delivery.ts's fetchPendingEvents/deliverEvents plus
// event-dispatcher.ts's processConsumer close this via pending_gaps: ids
// below the cursor that were invisible on some turn stay tracked (with the
// xmax that bounds their finality) until they either become visible
// (delivered) or are proven permanently rolled back (xmin passes that xmax).
// This mirrors the #443 fenced-rebuild gap, but for the live dispatch path
// (projection-rebuild.ts's final drain re-checks via a count fence;
// the live dispatcher has no such fence — it has pending_gaps instead).

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { DbConnection, DbTx } from "../../db/connection";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient } from "../../db/query";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { defineFeature } from "../../engine";
import { createEventDispatcher, type EventConsumer, type EventDispatcher } from "../../pipeline";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { sharedWidgetEntity, sharedWidgetTable, waitFor } from "../../testing";
import { generateId } from "../../utils";
import { SHARED_INSTANCE_SENTINEL } from "../event-consumer-state";

const executor = createEventStoreExecutor(sharedWidgetTable, sharedWidgetEntity, {
  entityName: "widget",
});

const feature = defineFeature("commitorder", (r) => {
  r.entity("widget", sharedWidgetEntity);
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, sharedWidgetEntity, "widget");
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterEach(async () => {
  await resetEventStore(stack, ["read_widgets"]);
});

// Normal append path — commits immediately on its own pooled connection,
// like the other dispatcher integration tests use for their control events.
async function appendWidget(name: string): Promise<void> {
  await executor.create({ name }, admin, tdb);
}

// executor.create() manages and commits its own transaction internally, so
// it cannot be used for the low-id writer that must stay open on demand —
// raw SQL on a caller-held tx (same shape as projection-rebuild's #443
// test) is the only way to grab an id and defer its commit.
async function insertWidgetCreatedEvent(tx: DbTx, name: string): Promise<void> {
  await asRawClient(tx).unsafe(
    `INSERT INTO "kumiko_events"
       (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
     VALUES ($1::uuid, 'widget', $2::uuid, 1, 'widget.created', $3::jsonb, '{}'::jsonb, 'test')`,
    [generateId(), admin.tenantId, JSON.stringify({ name })],
  );
}

function buildDispatcher(consumer: EventConsumer): EventDispatcher {
  return createEventDispatcher({
    db: stack.db,
    consumers: [consumer],
    context: { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
    batchSize: 200,
    pollIntervalMs: 5000,
  });
}

class RollbackSentinel extends Error {}

// Grabs an id (like insertWidgetCreatedEvent) but never commits — the row
// stays permanently invisible. Simulates the "burnt gap" case: a pending
// entry whose row will never appear, provable only once xmin passes the
// xmax recorded when the gap was first detected.
async function insertAndRollBackWidgetEvent(db: DbConnection, name: string): Promise<void> {
  await db
    .begin(async (tx: DbTx) => {
      await insertWidgetCreatedEvent(tx, name);
      throw new RollbackSentinel();
    })
    .catch((e: unknown) => {
      if (!(e instanceof RollbackSentinel)) throw e;
    });
}

async function readPendingGaps(
  db: DbConnection,
  consumerName: string,
): Promise<ReadonlyArray<{ from: string; to: string; xmax: string }>> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT "pending_gaps", jsonb_typeof("pending_gaps") AS kind FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2`,
    [consumerName, SHARED_INSTANCE_SENTINEL],
  )) as ReadonlyArray<{
    pending_gaps: ReadonlyArray<{ from: string; to: string; xmax: string }>;
    kind: string;
  }>;
  // A double-encoded write lands as a jsonb string scalar, not an array.
  if (rows[0] && rows[0].kind !== "array") throw new Error(`pending_gaps is jsonb ${rows[0].kind}`);
  return rows[0]?.pending_gaps ?? [];
}

// Jumps the id sequence far ahead before inserting, then leaves it there —
// simulates a retention prune (or a new consumer starting "beginning" over
// already-pruned history): a huge, permanent hole below the next cursor.
async function insertFarAwayWidgetEvent(db: DbConnection, name: string): Promise<bigint> {
  return db.begin(async (tx: DbTx) => {
    const [row] = (await asRawClient(tx).unsafe(
      `SELECT nextval(pg_get_serial_sequence('kumiko_events', 'id')) AS n`,
    )) as ReadonlyArray<{ n: string | bigint }>;
    const jumpedId = BigInt(row?.n ?? 0) + 100_000n;
    await asRawClient(tx).unsafe(
      `SELECT setval(pg_get_serial_sequence('kumiko_events', 'id'), $1)`,
      [jumpedId.toString()],
    );
    await asRawClient(tx).unsafe(
      `INSERT INTO "kumiko_events"
         (id, aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
       VALUES ($1, $2::uuid, 'widget', $3::uuid, 1, 'widget.created', $4::jsonb, '{}'::jsonb, 'test')`,
      [jumpedId.toString(), generateId(), admin.tenantId, JSON.stringify({ name })],
    );
    return jumpedId;
  });
}

describe("event-dispatcher — commit order vs. id order", () => {
  test("an event whose transaction commits late is still delivered once it commits", async () => {
    const seen: Array<{ id: string; name: string }> = [];
    const consumer: EventConsumer = {
      name: "commitorder:consumer",
      handler: async (event) => {
        seen.push({ id: event.id, name: String(event.payload["name"]) });
      },
    };
    const dispatcher = buildDispatcher(consumer);
    await dispatcher.ensureRegistered();

    const db = stack.db as DbConnection;

    // Tx A grabs the LOW id first but holds its transaction open —
    // uncommitted, so it stays invisible to fetchPendingEvents' plain SELECT.
    let releaseA!: () => void;
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let markAInserted!: () => void;
    const aInserted = new Promise<void>((resolve) => {
      markAInserted = resolve;
    });
    const aDone = db.begin(async (tx: DbTx) => {
      await insertWidgetCreatedEvent(tx, "A");
      markAInserted();
      await aGate;
    });
    await aInserted;

    // Tx B commits AFTER A grabbed its id, so B's id is HIGHER, and it's
    // the only one visible when the dispatcher first polls.
    await appendWidget("B");

    const firstPass = await dispatcher.runOnce();
    expect(firstPass.processed).toBe(1);
    expect(seen).toEqual([expect.objectContaining({ name: "B" })]);

    // A commits now — its lower id becomes visible, but the cursor already
    // advanced past B's higher id. `WHERE id > cursor` alone never revisits
    // it: the gap this test pins.
    releaseA();
    await aDone;

    const secondPass = await dispatcher.runOnce();
    expect(secondPass.processed).toBe(1);
    // Delivery order is events.id order, not append order: A's lower id is
    // delivered as a resolved pending gap, ahead of any id above the cursor.
    expect(seen.map((e) => e.name)).toEqual(["B", "A"]);
    expect(await readPendingGaps(db, consumer.name)).toEqual([]);
  });

  test("a rolled-back low-id write is proven burnt and never blocks later events", async () => {
    const seen: string[] = [];
    const consumer: EventConsumer = {
      name: "commitorder:burnt-gap-consumer",
      handler: async (event) => {
        seen.push(String(event.payload["name"]));
      },
    };
    const dispatcher = buildDispatcher(consumer);
    await dispatcher.ensureRegistered();

    const db = stack.db as DbConnection;

    // Reserves a low id, then rolls back — that id's row will never exist.
    await insertAndRollBackWidgetEvent(db, "burnt");
    await appendWidget("real");

    // First pass: "real" (the only visible row past the cursor) is
    // delivered; the rolled-back id below it is recorded as a pending gap.
    const firstPass = await dispatcher.runOnce();
    expect(firstPass.processed).toBe(1);
    expect(seen).toEqual(["real"]);
    expect(await readPendingGaps(db, consumer.name)).not.toEqual([]);

    let pendingGaps = await readPendingGaps(db, consumer.name);
    // xmin is cluster-wide, so a parallel test's open transaction can hold it
    // back briefly; wait for the condition, not a fixed number of passes.
    await waitFor(
      async () => {
        await dispatcher.runOnce();
        pendingGaps = await readPendingGaps(db, consumer.name);
        expect(pendingGaps).toEqual([]);
      },
      { delays: [20, 100, 500, 1000, 3000] },
    );

    expect(pendingGaps).toEqual([]);
    // The burnt id was never delivered — only "real" ever was.
    expect(seen).toEqual(["real"]);
  });

  test("a huge id jump stays O(1) pending_gaps entries, not one per missing id", async () => {
    const seen: string[] = [];
    const consumer: EventConsumer = {
      name: "commitorder:huge-gap-consumer",
      handler: async (event) => {
        seen.push(String(event.payload["name"]));
      },
    };
    const dispatcher = buildDispatcher(consumer);
    await dispatcher.ensureRegistered();

    const db = stack.db as DbConnection;

    await insertFarAwayWidgetEvent(db, "faraway");

    const firstPass = await dispatcher.runOnce();
    expect(firstPass.processed).toBe(1);
    expect(seen).toEqual(["faraway"]);

    // One contiguous range covers the whole skipped id space — not ~100000
    // entries, one per missing id.
    const gapsAfterJump = await readPendingGaps(db, consumer.name);
    expect(gapsAfterJump.length).toBeLessThan(10);

    // The sequence jumped past the gap, so a normal append never re-enters
    // it — this event's id sits above "faraway", not inside the hole.
    await appendWidget("after-jump");
    const secondPass = await dispatcher.runOnce();
    expect(secondPass.processed).toBe(1);
    expect(seen).toEqual(["faraway", "after-jump"]);

    let pendingGaps = await readPendingGaps(db, consumer.name);
    // xmin is cluster-wide, so a parallel test's open transaction can hold it
    // back briefly; wait for the condition, not a fixed number of passes.
    await waitFor(
      async () => {
        await dispatcher.runOnce();
        pendingGaps = await readPendingGaps(db, consumer.name);
        expect(pendingGaps).toEqual([]);
      },
      { delays: [20, 100, 500, 1000, 3000] },
    );
    expect(pendingGaps).toEqual([]);
  });
});
