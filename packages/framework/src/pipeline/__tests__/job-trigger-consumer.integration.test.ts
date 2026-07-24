// createJobTriggerEventConsumer — proves r.job's trigger.on can fire on an
// r.defineEvent QN appended by a multiStreamProjection's unsafeAppendEvent
// (kumiko-framework#1505). Mirrors document-ingest-foundation's actual
// request-ingest MSP (upload → fileRef.created → an owned defineEvent),
// the motivating case for this fix — fileRef.created itself never reaches
// jobRunner.handleEvent because the upload route appends it via the raw
// event-store executor, not a write-handler dispatch (see #1505).
//
// Not covered here: a job triggered on a write/query-handler QN still
// firing exactly once (unaffected by the new consumer). The full suite
// stays green (e.g. the lane-routing sample), but that's not a positive
// test of the partition guard — no stored event's `type` is ever a
// handler QN in practice (entity events are "entity.verb"; custom
// write-handlers like lane-routing's don't append to the store at all),
// so `getWriteHandler`/`getQueryHandler` in the new consumer's handler is
// defense-in-depth for an input shape the framework doesn't currently
// produce, not something exercised end-to-end by any test today.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { entityEventName } from "../../db";
import { defineFeature } from "../../engine";
import { createInMemoryFileProvider, type InMemoryFileProvider } from "../../files";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import { waitFor } from "../../testing";

const ITEM_REQUESTED_EVENT_QN = "job-trigger-fixture:event:item-requested";
const FILE_REF_CREATED = entityEventName("fileRef", "created");

const processedItems: Array<{ readonly fileRefId: string }> = [];

const jobTriggerFixtureFeature = defineFeature("job-trigger-fixture", (r) => {
  r.defineEvent("item-requested", z.object({ fileRefId: z.string().min(1) }));

  // Mirrors document-ingest-foundation's request-ingest MSP exactly: reacts
  // to fileRef.created, appends a NEW event via unsafeAppendEvent — no
  // write-handler behind the appended event itself.
  r.multiStreamProjection({
    name: "request-item",
    apply: {
      [FILE_REF_CREATED]: async (event, _tx, ctx) => {
        await ctx.unsafeAppendEvent({
          aggregateId: event.aggregateId,
          aggregateType: "job-trigger-fixture-request",
          type: ITEM_REQUESTED_EVENT_QN,
          payload: { fileRefId: event.aggregateId },
        });
      },
    },
  });

  // Under test: only reachable via createJobTriggerEventConsumer, since
  // ITEM_REQUESTED_EVENT_QN is an r.defineEvent QN, not a handler QN.
  r.job(
    "process-item",
    { trigger: { on: ITEM_REQUESTED_EVENT_QN }, runIn: "worker" },
    async (payload) => {
      processedItems.push({ fileRefId: payload["fileRefId"] as string });
    },
  );
});

let stack: TestStack;
let provider: InMemoryFileProvider;

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [jobTriggerFixtureFeature],
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  processedItems.length = 0;
  provider.clear();
});

describe("job-trigger event consumer", () => {
  test("a job triggers on an r.defineEvent QN appended by an MSP's unsafeAppendEvent", async () => {
    const token = await stack.jwt.sign(TestUsers.admin);
    const formData = new FormData();
    formData.append("file", new File([Buffer.from("hello")], "note.txt", { type: "text/plain" }));
    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    expect(res.status).toBe(201);

    await waitFor(async () => {
      // Drives both the MSP (appends item-requested off fileRef.created)
      // and the new job-trigger consumer (reacts to it) — may need more
      // than one pass since the MSP's append happens mid-drain.
      await stack.eventDispatcher?.runOnce();
      expect(processedItems).toHaveLength(1);
    });

    expect(processedItems[0]?.fileRefId).toBeTruthy();
  });
});
