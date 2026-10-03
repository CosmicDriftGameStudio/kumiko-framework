// trigger-event-ref — the workflow-run stream and the pending-set table keep a
// REFERENCE to the trigger / awaited event, never a copy of its payload, so a
// crypto-shred or archive of the source event also covers workflows.
//
// Source events are appended through real write handlers (real event store,
// real PII encryption under an in-memory KMS); the test never writes to the
// events table.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createSystemDbView, createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type AwaitedEventType,
  createSystemUser,
  defineFeature,
  defineWorkflow,
  type JobContext,
  qn,
  stepsPipeline,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  type WorkflowDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { workflowRunAggregateId } from "../aggregate-id.js";
import { registerEventTrigger } from "../event-trigger.js";
import { workflowRunnerFeature } from "../feature.js";

let stack: TestStack;
const admin = TestUsers.admin;

const FEATURE = "wfref";
const SOURCE_AGGREGATE_TYPE = "wfref-source";
const SIGNUP_EVENT = qn(FEATURE, "event", "signup");
const REPLIED_EVENT = qn(FEATURE, "event", "replied");

const PLAIN_EMAIL = "erase-me@example.com";
const PLAIN_NOTE = "plain-note-field";
const PLAIN_REPLY = "reply-body-field";

type ObservedResume = {
  readonly trigger: Record<string, unknown>;
  readonly replied: Record<string, unknown> | undefined;
};
const observed = new Map<string, ObservedResume>();

const refWorkflow = defineWorkflow({
  name: "wfref-run",
  trigger: { kind: "event", eventType: SIGNUP_EVENT },
  awaits: { replied: REPLIED_EVENT },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline<unknown, unknown, { readonly replied: AwaitedEventType }>(
    ({ r, awaits }) => [
      r.step.waitForEvent({
        event: awaits.replied,
        match: (ctx) => ({
          version: 1,
          expr: {
            kind: "atom",
            path: ["runKey"],
            op: { kind: "eq", value: (ctx.event.payload as { runKey: string }).runKey },
          },
        }),
        timeout: "P7D",
      }),
      r.step.compute("observe", (ctx) => {
        const trigger = ctx.event.payload as Record<string, unknown>;
        observed.set(String(trigger["runKey"]), {
          trigger,
          replied: ctx.steps[awaits.replied] as Record<string, unknown> | undefined,
        });
        return null;
      }),
      r.step.return({ isSuccess: true, data: undefined }),
    ],
  ),
});

const sourceFeature = defineFeature(FEATURE, (r) => {
  r.defineEvent(
    "signup",
    z.object({
      runKey: z.string(),
      subjectId: z.string(),
      email: z.string(),
      note: z.string(),
    }),
    { piiFields: { email: { personal: { of: "subjectId" } } } },
  );
  r.defineEvent(
    "replied",
    z.object({
      runKey: z.string(),
      subjectId: z.string(),
      from: z.string(),
      body: z.string(),
    }),
    { piiFields: { from: { personal: { of: "subjectId" } } } },
  );

  r.writeHandler(
    "emit-signup",
    z.object({
      aggregateId: z.uuid(),
      runKey: z.string(),
      subjectId: z.string(),
      email: z.string(),
      note: z.string(),
    }),
    async (event, ctx) => {
      const { aggregateId, ...payload } = event.payload;
      await ctx.unsafeAppendEvent({
        aggregateId,
        aggregateType: SOURCE_AGGREGATE_TYPE,
        type: SIGNUP_EVENT,
        payload,
      });
      return { isSuccess: true as const, data: { aggregateId } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "emit-replied",
    z.object({
      runKey: z.string(),
      subjectId: z.string(),
      from: z.string(),
      body: z.string(),
    }),
    async (event, ctx) => {
      const aggregateId = crypto.randomUUID();
      await ctx.unsafeAppendEvent({
        aggregateId,
        aggregateType: SOURCE_AGGREGATE_TYPE,
        type: REPLIED_EVENT,
        payload: event.payload,
      });
      return { isSuccess: true as const, data: { aggregateId } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "archive-source",
    z.object({ aggregateId: z.uuid() }),
    async (event, ctx) => {
      await ctx.archiveStream(event.payload.aggregateId, {
        aggregateType: SOURCE_AGGREGATE_TYPE,
      });
      return { isSuccess: true as const, data: { aggregateId: event.payload.aggregateId } };
    },
    { access: { roles: ["Admin"] } },
  );

  registerEventTrigger(r, refWorkflow as unknown as WorkflowDefinition);
});

const noopLogger: JobContext["log"] = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
};

let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  stack = await setupTestStack({ features: [workflowRunnerFeature, sourceFeature] });
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

afterEach(() => {
  observed.clear();
});

async function emitSignup(runKey: string, subjectId: string): Promise<string> {
  const aggregateId = crypto.randomUUID();
  await stack.http.writeOk(
    qn(FEATURE, "write", "emit-signup"),
    { aggregateId, runKey, subjectId, email: PLAIN_EMAIL, note: PLAIN_NOTE },
    admin,
  );
  // Two passes: the trigger MSP writes run-started + the suspension on the
  // first, pending-projection only sees that suspension on the second.
  await stack.eventDispatcher?.runOnce();
  await stack.eventDispatcher?.runOnce();
  return aggregateId;
}

async function emitReplied(runKey: string, subjectId: string): Promise<void> {
  await stack.http.writeOk(
    qn(FEATURE, "write", "emit-replied"),
    { runKey, subjectId, from: "someone@example.com", body: PLAIN_REPLY },
    admin,
  );
  await stack.eventDispatcher?.runOnce();
}

async function loadRunEvents(runId: string) {
  return selectMany(
    stack.db,
    eventsTable,
    { aggregateId: runId },
    { orderBy: { col: "version", direction: "asc" } },
  );
}

async function pendingRow(runId: string) {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT trigger_event_type AS "triggerEventType", trigger_payload AS "triggerPayload", trigger_event_ref AS "triggerEventRef" FROM workflow_run_pending WHERE run_id = $1 AND step_index = 0`,
    [runId],
  )) as ReadonlyArray<{
    triggerEventType: string | null;
    triggerPayload: unknown;
    triggerEventRef: unknown;
  }>;
  return rows[0];
}

async function runResumeDueRunsJob(): Promise<void> {
  const job = stack.registry.getJob("workflow-runner:job:resume-due-runs");
  expect(job).toBeDefined();
  if (!job) return;
  const systemUser = createSystemUser(admin.tenantId);
  const ctx: JobContext = {
    db: createTenantDb(stack.db, admin.tenantId),
    systemDb: createSystemDbView(
      createTenantDb(stack.db, admin.tenantId, "system", undefined, undefined, undefined, {
        unsafeRaw: { reason: "test: job context mirrors systemScope() grant" },
      }),
    ),
    registry: stack.registry,
    systemUser,
    log: noopLogger,
    triggeredBy: null,
    _tenantId: admin.tenantId,
    write: (name, payload) => stack.dispatcher.write(name, payload, systemUser),
  } as JobContext;
  await job.handler({}, ctx);
}

describe("workflow trigger-event reference", () => {
  test("run stream and pending row hold references only; resume after shredding sees no PII plaintext", async () => {
    const runKey = crypto.randomUUID();
    const triggerSubject = `subject-${crypto.randomUUID()}`;
    const replySubject = `subject-${crypto.randomUUID()}`;
    const runId = workflowRunAggregateId(refWorkflow.name, runKey);

    const sourceAggregateId = await emitSignup(runKey, triggerSubject);

    const suspended = await loadRunEvents(runId);
    expect(suspended.map((e) => e["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
    ]);
    const started = suspended[0]?.["payload"] as Record<string, unknown>;
    expect(started["triggerPayload"]).toBeUndefined();
    expect(started["triggerEventRef"]).toMatchObject({
      aggregateId: sourceAggregateId,
      version: 1,
    });
    // No run-stream event may carry any value of the trigger payload.
    const streamText = JSON.stringify(suspended.map((e) => e["payload"]));
    expect(streamText).not.toContain(PLAIN_NOTE);
    expect(streamText).not.toContain("kumiko-pii");
    expect(streamText).not.toContain(PLAIN_EMAIL);

    await emitReplied(runKey, replySubject);
    const marked = await pendingRow(runId);
    expect(marked?.triggerEventType).toBe(REPLIED_EVENT);
    expect(marked?.triggerPayload).toBeNull();
    expect(marked?.triggerEventRef).toMatchObject({ aggregateId: expect.any(String) });
    expect(JSON.stringify(marked)).not.toContain(PLAIN_REPLY);

    await kms.eraseKey({ kind: "user", userId: triggerSubject });
    await runResumeDueRunsJob();

    const finished = await loadRunEvents(runId);
    expect(finished.map((e) => e["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_COMPLETED_TYPE,
    ]);

    const seen = observed.get(runKey);
    expect(seen).toBeDefined();
    // Shredded form: the PII field is ciphertext whose key is gone, never plaintext.
    expect(isPiiCiphertext(seen?.trigger["email"])).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(PLAIN_EMAIL);
    // Non-PII fields are still resolved from the event store.
    expect(seen?.trigger["note"]).toBe(PLAIN_NOTE);
    expect(seen?.replied?.["body"]).toBe(PLAIN_REPLY);
  });

  test("resume fails with trigger_event_unavailable when the trigger event is no longer loadable", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(refWorkflow.name, runKey);

    const sourceAggregateId = await emitSignup(runKey, `subject-${crypto.randomUUID()}`);
    await stack.http.writeOk(
      qn(FEATURE, "write", "archive-source"),
      { aggregateId: sourceAggregateId },
      admin,
    );
    await emitReplied(runKey, `subject-${crypto.randomUUID()}`);
    await runResumeDueRunsJob();

    const rows = await loadRunEvents(runId);
    expect(rows.map((e) => e["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_FAILED_TYPE,
    ]);
    expect(rows[3]?.["payload"]).toMatchObject({ reason: "trigger_event_unavailable" });
    expect(observed.has(runKey)).toBe(false);
  });

  test("resume fails with awaited_event_unavailable when the matched awaited event cannot be loaded", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(refWorkflow.name, runKey);

    await emitSignup(runKey, `subject-${crypto.randomUUID()}`);
    // Projection table, not the event store: point the matched row at an
    // event id that does not exist.
    await asRawClient(stack.db).unsafe(
      `UPDATE workflow_run_pending SET trigger_event_type = $1, trigger_event_ref = $2::jsonb, wake_at = now() - interval '1 minute' WHERE run_id = $3 AND step_index = 0`,
      [
        REPLIED_EVENT,
        JSON.stringify({ eventId: "999999999", aggregateId: crypto.randomUUID(), version: 1 }),
        runId,
      ],
    );
    await runResumeDueRunsJob();

    const rows = await loadRunEvents(runId);
    expect(rows.map((e) => e["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_FAILED_TYPE,
    ]);
    expect(rows[3]?.["payload"]).toMatchObject({ reason: "awaited_event_unavailable" });
    expect(observed.has(runKey)).toBe(false);
  });
});
