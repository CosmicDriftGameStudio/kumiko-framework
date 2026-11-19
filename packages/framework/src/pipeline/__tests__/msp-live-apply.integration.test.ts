// The live MSP consumer upcasts stored events like rebuild does, and applies inside the
// dispatcher's turn tx: a throwing apply leaves no partial writes behind for the retry.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../../db/dialect.ts";
import { insertOne, selectMany } from "../../db/query.ts";
import { defineFeature } from "../../engine/index.ts";
import { append } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";

const LABEL_SET_EVENT_QN = "msp-live:event:label-set";
const FLAKY_EVENT_QN = "msp-live:event:flaky";

// No unique key on eventId: without the fix a double apply shows up as two rows instead of a dead-letter.
const liveLabelTable = pgTable("read_msp_live_labels", {
  id: pgUuid("id").primaryKey(),
  eventId: pgText("event_id").notNull(),
  label: pgText("label").notNull(),
});

let flakyCalls = 0;

const mspLiveFeature = defineFeature("msp-live", (r) => {
  r.defineEvent("label-set", z.object({ id: z.uuid(), label: z.string() }), {
    piiFields: "none",
    version: 2,
    migrations: [{ fromVersion: 1, toVersion: 2, transform: { default: { label: "from-v1" } } }],
  });
  r.defineEvent("flaky", z.object({ id: z.uuid() }), { piiFields: "none" });

  r.multiStreamProjection({
    name: "live-labels",
    table: liveLabelTable,
    apply: {
      [LABEL_SET_EVENT_QN]: async (event, db) => {
        await insertOne(db, liveLabelTable, {
          id: generateId(),
          eventId: String(event.id),
          label: String(event.payload["label"]),
        });
      },
      [FLAKY_EVENT_QN]: async (event, db) => {
        await insertOne(db, liveLabelTable, {
          id: generateId(),
          eventId: String(event.id),
          label: "flaky",
        });
        flakyCalls += 1;
        if (flakyCalls === 1) throw new Error("flaky once");
      },
    },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [mspLiveFeature], systemHooks: [] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  flakyCalls = 0;
});

async function appendFirstVersion(type: string, aggregateType: string, payload: object) {
  const aggregateId = generateId();
  await append(stack.db, {
    aggregateId,
    aggregateType,
    tenantId: TestUsers.admin.tenantId,
    expectedVersion: 0,
    type,
    eventVersion: 1,
    payload: { id: aggregateId, ...payload },
    metadata: { userId: TestUsers.admin.id },
  });
}

describe("live multi-stream projection apply", () => {
  test("live MSP apply sees the upcast payload of a v1 event", async () => {
    await appendFirstVersion(LABEL_SET_EVENT_QN, "msp-live-label", {});

    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      const rows = await selectMany(stack.db, liveLabelTable);
      expect(rows.length).toBeGreaterThan(0);
    });

    const rows = await selectMany<{ label: string }>(stack.db, liveLabelTable);
    expect(rows.map((row) => row.label)).toEqual(["from-v1"]);
  });

  test("a throwing apply leaves no row behind and the retry writes exactly one", async () => {
    await appendFirstVersion(FLAKY_EVENT_QN, "msp-live-flaky", {});

    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      expect(flakyCalls).toBe(2);
    });

    const rows = await selectMany<{ label: string }>(stack.db, liveLabelTable, { label: "flaky" });
    expect(flakyCalls).toBe(2);
    expect(rows).toHaveLength(1);
  });
});
