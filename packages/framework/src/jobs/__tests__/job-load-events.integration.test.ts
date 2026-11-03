import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import type { DbConnection, DbTx } from "../../db/connection.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { append } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "read_jobload_notes",
  fields: { text: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

const admin = TestUsers.admin;
const foreignTenantId = crypto.randomUUID();
const loaded: { type: string; version: number; payload: unknown }[][] = [];

const jobLoadFeature = defineFeature("jobload", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.defineEvent("noted", z.object({ text: z.string(), length: z.number().int() }), {
    piiFields: "none",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        transform: (payload) => {
          const { text } = payload as { text: string };
          return { text, length: text.length };
        },
      },
    ],
  });

  r.job("load-stream", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const events = await ctx.events.load(String(payload["noteId"]));
    loaded.push(events.map(({ type, version, payload: p }) => ({ type, version, payload: p })));
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [jobLoadFeature], jobs: { consumerLane: "worker" } });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  loaded.length = 0;
  await resetEventStore(stack, []);
});

async function seedV1Note(noteId: string, tenantId: string): Promise<void> {
  await (stack.db as DbConnection).begin(async (tx: DbTx) => {
    await append(tx, {
      aggregateId: noteId,
      aggregateType: "note",
      tenantId,
      expectedVersion: 0,
      type: "jobload:event:noted",
      eventVersion: 1,
      payload: { text: "hello" },
      metadata: { userId: admin.id },
    });
  });
}

describe("JobContext.events.load", () => {
  test("loads a stream of the job's tenant through the upcaster chain", async () => {
    const noteId = crypto.randomUUID();
    await seedV1Note(noteId, admin.tenantId);

    await stack.jobRunner?.dispatch("jobload:job:load-stream", {
      noteId,
      tenantId: admin.tenantId,
    });

    await waitFor(() => expect(loaded).toHaveLength(1));
    expect(loaded[0]).toEqual([
      { type: "jobload:event:noted", version: 1, payload: { text: "hello", length: 5 } },
    ]);
  });

  test("a stream of another tenant yields nothing", async () => {
    const noteId = crypto.randomUUID();
    await seedV1Note(noteId, foreignTenantId);

    await stack.jobRunner?.dispatch("jobload:job:load-stream", {
      noteId,
      tenantId: admin.tenantId,
    });

    await waitFor(() => expect(loaded).toHaveLength(1));
    expect(loaded[0]).toEqual([]);
  });
});
