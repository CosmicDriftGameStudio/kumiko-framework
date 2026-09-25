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
import * as z from "zod";
import { entityEventName } from "../../db";
import { defineFeature } from "../../engine";
import { createInMemoryFileProvider, type InMemoryFileProvider } from "../../files";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import { waitFor } from "../../testing";
import { generateId } from "../../utils";

const ITEM_REQUESTED_EVENT_QN = "job-trigger-fixture:event:item-requested";
const FILE_REF_CREATED = entityEventName("fileRef", "created");

const processedItems: Array<{ readonly fileRefId: string }> = [];

const jobTriggerFixtureFeature = defineFeature("job-trigger-fixture", (r) => {
  r.defineEvent("item-requested", z.object({ fileRefId: z.string().min(1) }), {
    piiFields: "none",
  });

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

// trigger.where partition fixture — two jobs share one broad QN, each
// filtered to a disjoint payload.kind, mirroring document-ingest-foundation's
// N-providers-one-QN shape without pulling in the whole feature.
const WHERE_ITEM_REQUESTED_EVENT_QN = "job-trigger-where-fixture:event:item-requested";

const alphaProcessed: Array<{ readonly fileRefId: string }> = [];
const betaProcessed: Array<{ readonly fileRefId: string }> = [];

const jobTriggerWhereFixtureFeature = defineFeature("job-trigger-where-fixture", (r) => {
  r.defineEvent(
    "item-requested",
    z.object({ fileRefId: z.string().min(1), kind: z.enum(["alpha", "beta"]) }),
    { piiFields: "none" },
  );

  r.multiStreamProjection({
    name: "request-item",
    apply: {
      [FILE_REF_CREATED]: async (event, _tx, ctx) => {
        const fileName = event.payload["fileName"];
        const kind =
          typeof fileName === "string" && fileName.startsWith("alpha-") ? "alpha" : "beta";
        await ctx.unsafeAppendEvent({
          aggregateId: event.aggregateId,
          aggregateType: "job-trigger-where-fixture-request",
          type: WHERE_ITEM_REQUESTED_EVENT_QN,
          payload: { fileRefId: event.aggregateId, kind },
        });
      },
    },
  });

  // Under test: both jobs trigger on the SAME QN; only the one whose
  // `where` matches the appended payload's `kind` may run.
  r.job(
    "process-alpha",
    { trigger: { on: WHERE_ITEM_REQUESTED_EVENT_QN, where: { kind: "alpha" } }, runIn: "worker" },
    async (payload) => {
      alphaProcessed.push({ fileRefId: payload["fileRefId"] as string });
    },
  );
  r.job(
    "process-beta",
    { trigger: { on: WHERE_ITEM_REQUESTED_EVENT_QN, where: { kind: "beta" } }, runIn: "worker" },
    async (payload) => {
      betaProcessed.push({ fileRefId: payload["fileRefId"] as string });
    },
  );
});

let stack: TestStack;
let provider: InMemoryFileProvider;
let whereStack: TestStack;
let whereProvider: InMemoryFileProvider;

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [jobTriggerFixtureFeature],
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker", queueNamePrefix: `job-trigger-fixture-${generateId()}` },
  });
  whereProvider = createInMemoryFileProvider();
  whereStack = await setupTestStack({
    features: [jobTriggerWhereFixtureFeature],
    files: { storageProvider: whereProvider },
    // Distinct prefix from `stack` above — createTestRedis's keyPrefix
    // isolation doesn't cover BullMQ's own connections, so without this both
    // JobRunners would race each other on the same default queue name.
    jobs: { consumerLane: "worker", queueNamePrefix: `job-trigger-where-fixture-${generateId()}` },
  });
});

afterAll(async () => {
  await stack.cleanup();
  await whereStack.cleanup();
});

beforeEach(() => {
  processedItems.length = 0;
  provider.clear();
  alphaProcessed.length = 0;
  betaProcessed.length = 0;
  whereProvider.clear();
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

describe("job-trigger event consumer — trigger.where partitions one QN across jobs", () => {
  test("only the job whose where matches the payload runs — both partitions checked, not just the absence of the other", async () => {
    const token = await whereStack.jwt.sign(TestUsers.admin);
    async function uploadKind(fileName: string): Promise<string> {
      const formData = new FormData();
      formData.append("file", new File([Buffer.from("hello")], fileName, { type: "text/plain" }));
      const res = await whereStack.app.request("/api/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      return body.id;
    }

    const alphaFileRefId = await uploadKind("alpha-note.txt");
    const betaFileRefId = await uploadKind("beta-note.txt");

    await waitFor(async () => {
      // Drives both jobs' consumers in the same pass — asserting both lists
      // are non-empty before checking membership rules out "beta simply
      // hasn't run yet" as an explanation for an empty betaProcessed.
      await whereStack.eventDispatcher?.runOnce();
      expect(alphaProcessed).toHaveLength(1);
      expect(betaProcessed).toHaveLength(1);
    });

    expect(alphaProcessed).toEqual([{ fileRefId: alphaFileRefId }]);
    expect(betaProcessed).toEqual([{ fileRefId: betaFileRefId }]);
  });
});
