import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { UnsafeAppendEventFn } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../../db/dialect.ts";
import { insertOne, selectMany } from "../../db/query.ts";
import {
  createEntity,
  createTextField,
  defineFeature,
  type JobContext,
} from "../../engine/index.ts";

import { loadAggregate } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "read_jobappend_notes",
  fields: { text: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

const noteLogTable = pgTable("read_jobappend_note_log", {
  noteId: pgUuid("note_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  text: pgText("text").notNull(),
});

// The fixture event map in this package types ctx.events.append to one probe event; same runtime, looser type.
function untypedAppend(ctx: JobContext): UnsafeAppendEventFn {
  return ctx.events.append as unknown as UnsafeAppendEventFn;
}

const admin = TestUsers.admin;
const jobFailures: string[] = [];

const otherFeature = defineFeature("jobappendother", (r) => {
  r.defineEvent("foreign", z.object({ text: z.string() }), { piiFields: "none" });
});

const jobAppendFeature = defineFeature("jobappend", (r) => {
  r.entity({ name: "note", ...noteEntity });
  const noted = r.defineEvent("noted", z.object({ text: z.string() }), { piiFields: "none" });

  r.projection({
    name: "note-log",
    source: "note",
    table: noteLogTable,
    apply: {
      [noted.name]: async (event, tx) => {
        const payload = event.payload as { text: string };
        await insertOne(tx, noteLogTable, {
          noteId: event.aggregateId,
          tenantId: event.tenantId,
          text: payload.text,
        });
      },
    },
  });

  r.job("append-own", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    await untypedAppend(ctx)({
      aggregateId: String(payload["noteId"]),
      aggregateType: "note",
      type: noted.name,
      payload: { text: String(payload["text"]) },
    });
  });

  r.job("append-foreign", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    try {
      await untypedAppend(ctx)({
        aggregateId: String(payload["noteId"]),
        aggregateType: "note",
        type: "jobappendother:event:foreign",
        payload: { text: "x" },
      });
    } catch (error) {
      jobFailures.push(error instanceof Error ? error.message : String(error));
    }
  });

  r.job("append-invalid", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    try {
      await untypedAppend(ctx)({
        aggregateId: String(payload["noteId"]),
        aggregateType: "note",
        type: noted.name,
        payload: { text: 42 },
      });
    } catch (error) {
      jobFailures.push(error instanceof Error ? error.message : String(error));
    }
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [jobAppendFeature, otherFeature],
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  jobFailures.length = 0;
  await resetEventStore(stack, ["read_jobappend_note_log"]);
});

describe("JobContext.appendEvent", () => {
  test("appends an own-feature event and runs the inline projection", async () => {
    const noteId = crypto.randomUUID();
    await stack.jobRunner?.dispatch("jobappend:job:append-own", {
      noteId,
      text: "hello",
      tenantId: admin.tenantId,
    });

    await waitFor(async () => {
      expect((await selectMany(stack.db, noteLogTable, { noteId })).length).toBe(1);
    });
    const events = await loadAggregate(stack.db, noteId, admin.tenantId);
    expect(events.map((e) => e.type)).toEqual(["jobappend:event:noted"]);
  });

  test("rejects another feature's event", async () => {
    await stack.jobRunner?.dispatch("jobappend:job:append-foreign", {
      noteId: crypto.randomUUID(),
      tenantId: admin.tenantId,
    });

    await waitFor(() => expect(jobFailures).toHaveLength(1));
    expect(jobFailures[0]).toContain("belongs to feature");
  });

  test("rejects an invalid payload", async () => {
    const noteId = crypto.randomUUID();
    await stack.jobRunner?.dispatch("jobappend:job:append-invalid", {
      noteId,
      tenantId: admin.tenantId,
    });

    await waitFor(() => expect(jobFailures).toHaveLength(1));
    expect(await selectMany(stack.db, noteLogTable, { noteId })).toHaveLength(0);
  });
});
