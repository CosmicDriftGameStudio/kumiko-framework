// event-wakeup — the event-based resume path (framework#2513 Phase 3b)
// against real Postgres.
//
// Fires the AWAITED domain event (not the workflow's own trigger event)
// through a real event-dispatcher pass so event-subscriber.ts's MSP
// observes it, then drives `resume-due-runs` directly via
// stack.registry.getJob(...) — same style as resume-loop.integration.test.ts
// — to exercise the full resume-run handler off the row the subscriber
// marked due.
//
// The workflow under test reads the matched event's payload back via a
// resolver (`ctx.steps[awaits.replied]`) in the step right after
// waitForEvent and asserts it inline, throwing on a mismatch. Steps that
// resume a suspended run always execute inside resume-run's own
// workflow-runner write-handler context, which only owns workflow-runner's
// own event types (see resume-run.write.ts's module doc) — a custom
// business event appended from a resumed step would need the owning
// feature's write-handler context instead, unrelated to what Phase 3b
// threads through, so throw-on-mismatch is the direct probe: the run
// reaching workflow.run-completed instead of workflow.run-failed IS the
// assertion that ctx.steps[awaits.replied] held the expected payload.
// r.step.return's own `data` is discarded for workflow-triggered runs (see
// workflow-runner.integration.test.ts) — this sidesteps that too.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type AwaitedEventType,
  createSystemUser,
  defineFeature,
  defineWorkflow,
  type JobContext,
  stepsPipeline,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  type WorkflowDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { workflowRunAggregateId } from "../aggregate-id";
import { registerEventTrigger } from "../event-trigger";
import { workflowRunnerFeature } from "../feature";

let stack: TestStack;
const admin = TestUsers.admin;
const T = getTemporal();

// "wk-" prefix — the workflow-registry + event-subscriber MSP registration
// are process-global; other test files in this suite use their own prefix
// (wr-, rl-) for the same reason (see resume-loop.integration.test.ts).
const waitForEventWorkflow = defineWorkflow({
  name: "wk-wait-for-event",
  trigger: { kind: "event", eventType: "wk-test.start" },
  awaits: { replied: "wk-test.replied" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline<unknown, unknown, { readonly replied: AwaitedEventType }>(
    ({ r, awaits }) => [
      r.step.waitForEvent({
        event: awaits.replied,
        match: {
          version: 1,
          expr: { kind: "atom", path: ["from"], op: { kind: "eq", value: "match@example.com" } },
        },
        timeout: "P7D",
      }),
      r.step.compute("seen", (ctx) => {
        const payload = ctx.steps[awaits.replied] as { from: string; body: string } | undefined;
        if (payload?.from !== "match@example.com" || payload.body !== "hi") {
          throw new Error(`triggerPayload not threaded: got ${JSON.stringify(payload)}`);
        }
        return payload;
      }),
      r.step.return({ isSuccess: true, data: undefined }),
    ],
  ),
});

const timeoutWorkflow = defineWorkflow({
  name: "wk-wait-for-event-timeout",
  trigger: { kind: "event", eventType: "wk-test.timeout-start" },
  awaits: { replied: "wk-test.timeout-replied" },
  idempotencyKey: ({ payload }) => (payload as { runKey: string }).runKey,
  steps: stepsPipeline<unknown, unknown, { readonly replied: AwaitedEventType }>(
    ({ r, awaits }) => [
      r.step.waitForEvent({
        event: awaits.replied,
        // Absolute ISO timestamp (not a "P..."/"PT..." duration) — resolves
        // straight to timeoutAt, already in the past, no wakeAt-tampering
        // needed (same trick rl-wait's `forIso` uses).
        timeout: (ctx) => (ctx.event.payload as { timeoutIso: string }).timeoutIso,
      }),
      r.step.compute("seen", (ctx) => {
        const payload = ctx.steps[awaits.replied];
        // pending.triggerPayload round-trips through jsonb as null, not
        // undefined, when the row was never matched (timeout path).
        if (payload != null) {
          throw new Error(
            `expected no triggerPayload on a timeout, got ${JSON.stringify(payload)}`,
          );
        }
        return payload;
      }),
      r.step.return({ isSuccess: true, data: undefined }),
    ],
  ),
});

// The two casts below only erase TAwaits's literal key type (`{replied: ...}`
// -> the default `Record<string, string>`) — registerEventTrigger itself
// stays generic-free (it never reads the pipeline's branded awaits map, only
// workflow.awaits's plain string values), so this is the narrow-to-wide
// widening cast the `const TAwaits` inference on defineWorkflow forces at
// every call site, not a loss of type safety over real behavior.
const testTriggersFeature = defineFeature("workflow-runner-event-wakeup-test-triggers", (r) => {
  registerEventTrigger(r, waitForEventWorkflow as unknown as WorkflowDefinition);
  registerEventTrigger(r, timeoutWorkflow as unknown as WorkflowDefinition);
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

async function insertEvent(
  type: string,
  payload: Record<string, unknown>,
  user: { readonly id: string; readonly tenantId: string } = admin,
): Promise<void> {
  await insertOne(stack.db, eventsTable, {
    aggregateId: crypto.randomUUID(),
    aggregateType: "wk-test-source",
    tenantId: user.tenantId,
    version: 1,
    type,
    eventVersion: 1,
    payload,
    metadata: { userId: user.id },
    createdBy: user.id,
  });
}

async function fireTrigger(
  type: string,
  payload: Record<string, unknown>,
  user: { readonly id: string; readonly tenantId: string } = admin,
): Promise<void> {
  await insertEvent(type, payload, user);
  // Two passes: event-trigger's MSP writes run-started + the suspension on
  // the first pass; pending-projection only observes that newly-written
  // suspension event on a pass after it exists.
  await stack.eventDispatcher?.runOnce();
  await stack.eventDispatcher?.runOnce();
}

async function fireAwaitedEvent(
  type: string,
  payload: Record<string, unknown>,
  user: { readonly id: string; readonly tenantId: string } = admin,
): Promise<void> {
  await insertEvent(type, payload, user);
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

async function pendingRow(
  runId: string,
  stepIndex: number,
): Promise<
  { triggerEventType: string | null; triggerPayload: unknown; wakeAt: string } | undefined
> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT trigger_event_type AS "triggerEventType", trigger_payload AS "triggerPayload", wake_at AS "wakeAt" FROM workflow_run_pending WHERE run_id = $1 AND step_index = $2`,
    [runId, stepIndex],
  )) as ReadonlyArray<{ triggerEventType: string | null; triggerPayload: unknown; wakeAt: string }>;
  return rows[0];
}

async function runResumeDueRunsJob(tenantId: string): Promise<void> {
  const job = stack.registry.getJob("workflow-runner:job:resume-due-runs");
  expect(job).toBeDefined();
  if (!job) return;

  const systemUser = createSystemUser(tenantId);
  const ctx: JobContext = {
    db: stack.db,
    registry: stack.registry,
    systemUser,
    log: noopLogger,
    triggeredBy: null,
    _tenantId: tenantId,
    write: (qn, payload) => stack.dispatcher.write(qn, payload, systemUser),
  } as JobContext;
  await job.handler({}, ctx);
}

describe("workflow-runner event-wakeup", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [workflowRunnerFeature, testTriggersFeature] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("matching awaited event marks the row due; resume-due-runs completes the run and a later step sees the payload", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(waitForEventWorkflow.name, runKey);

    await fireTrigger("wk-test.start", { runKey });
    expect((await pendingRow(runId, 0))?.triggerEventType).toBeNull();

    await fireAwaitedEvent("wk-test.replied", { from: "match@example.com", body: "hi" });

    const marked = await pendingRow(runId, 0);
    expect(marked?.triggerEventType).toBe("wk-test.replied");
    expect(marked?.triggerPayload).toEqual({ from: "match@example.com", body: "hi" });

    await runResumeDueRunsJob(admin.tenantId);

    // The "seen" compute step throws if ctx.steps[awaits.replied] doesn't
    // hold the exact triggerPayload — reaching run-completed (not
    // run-failed) IS the proof resume-run threaded it through correctly.
    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_COMPLETED_TYPE,
    ]);
  });

  test("awaited event that fails matchExpr leaves the row untouched, no resume", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(waitForEventWorkflow.name, runKey);

    await fireTrigger("wk-test.start", { runKey });
    const before = await pendingRow(runId, 0);
    expect(before?.triggerEventType).toBeNull();

    await fireAwaitedEvent("wk-test.replied", { from: "someone-else@example.com", body: "hi" });

    const after = await pendingRow(runId, 0);
    expect(after?.triggerEventType).toBeNull();
    expect(after?.wakeAt).toEqual(before?.wakeAt);

    await runResumeDueRunsJob(admin.tenantId);
    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
    ]);
  });

  test("an event no workflow awaits leaves every pending row untouched", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(waitForEventWorkflow.name, runKey);

    await fireTrigger("wk-test.start", { runKey });
    const before = await pendingRow(runId, 0);

    await fireAwaitedEvent("wk-test.nobody-awaits-this", { anything: true });

    const after = await pendingRow(runId, 0);
    expect(after).toEqual(before);
  });

  test("tenant isolation: another tenant's matching event does not wake this tenant's run", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(waitForEventWorkflow.name, runKey);

    await fireTrigger("wk-test.start", { runKey });
    expect((await pendingRow(runId, 0))?.triggerEventType).toBeNull();

    await fireAwaitedEvent(
      "wk-test.replied",
      { from: "match@example.com", body: "hi" },
      TestUsers.otherTenant,
    );

    expect((await pendingRow(runId, 0))?.triggerEventType).toBeNull();

    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
    ]);
  });

  test("timeout path: no matching event ever arrives, wakeAt (from timeoutAt) elapses, resume-due-runs still wakes the run", async () => {
    const runKey = crypto.randomUUID();
    const runId = workflowRunAggregateId(timeoutWorkflow.name, runKey);
    const pastIso = T.Now.instant().subtract({ hours: 1 }).toString();

    await fireTrigger("wk-test.timeout-start", { runKey, timeoutIso: pastIso });
    expect((await pendingRow(runId, 0))?.triggerEventType).toBeNull();

    await runResumeDueRunsJob(admin.tenantId);

    // The "seen" compute step throws if ctx.steps[awaits.replied] is
    // anything other than undefined on a timeout resume — reaching
    // run-completed proves resume-run left it unset (pending.triggerPayload
    // stayed NULL, never matched).
    const rows = await loadRunEvents(runId);
    expect(rows.map((row) => row["type"])).toEqual([
      WORKFLOW_RUN_STARTED_TYPE,
      WORKFLOW_WAITING_FOR_EVENT_TYPE,
      WORKFLOW_RESUMED_TYPE,
      WORKFLOW_RUN_COMPLETED_TYPE,
    ]);
  });
});
