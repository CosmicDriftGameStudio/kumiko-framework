import {
  computeDefinitionFingerprint,
  defineWorkflow,
  pipeline,
  type WorkflowDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { VersionConflictError } from "@cosmicdrift/kumiko-framework/event-store";
import { describe, expect, it, mock } from "bun:test";
import { type CronWorkflow, nextCronDate, runDueCronWorkflows } from "../cron-scheduler";
import { registerEventTrigger } from "../event-trigger";
import {
  dailyReportWorkflow,
  resilientWebhookWorkflow,
  userOnboardingSteps,
  userOnboardingWorkflow,
} from "../feature";
import { createInMemorySuspendedRunFetcher } from "../postgres-resume-loop";
import { runResumeLoop, type SuspendableRun } from "../resume-loop";
import { startAndRunWorkflow } from "../workflow-runner";

function makeWaitWorkflow(name: string) {
  return defineWorkflow({
    name,
    trigger: { kind: "event", eventType: "demo.fired" },
    steps: pipeline(({ r }) => [
      r.step.wait({ for: "PT1H" }),
      r.step.return({ isSuccess: true, data: { result: "resumed" } }),
    ]),
  });
}

function makeReturnOnlyWorkflow(name: string) {
  return defineWorkflow({
    name,
    trigger: { kind: "event", eventType: "demo.fired" },
    steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
  });
}

describe("workflow-engine", () => {
  it("defineWorkflow returns a valid WorkflowDefinition", () => {
    expect(userOnboardingWorkflow.__kind).toBe("workflow");
    expect(userOnboardingWorkflow.name).toBe("user-onboarding");
    const trigger = userOnboardingWorkflow.trigger;
    if (trigger.kind !== "event") throw new Error("expected event trigger");
    expect(trigger.eventType).toBe("user.signed-up");
    expect(typeof userOnboardingWorkflow.idempotencyKey).toBe("function");
  });

  it("defines a resilient-webhook workflow with event trigger", () => {
    expect(resilientWebhookWorkflow.__kind).toBe("workflow");
    expect(resilientWebhookWorkflow.name).toBe("resilient-webhook");
    const trigger = resilientWebhookWorkflow.trigger;
    if (trigger.kind !== "event") throw new Error("expected event trigger");
    expect(trigger.eventType).toBe("data.processed");
  });

  it("defines a daily-report workflow with cron trigger", () => {
    expect(dailyReportWorkflow.__kind).toBe("workflow");
    expect(dailyReportWorkflow.name).toBe("daily-report");
    const trigger = dailyReportWorkflow.trigger;
    if (trigger.kind !== "cron") throw new Error("expected cron trigger");
    expect(trigger.schedule).toBe("0 9 * * *");
  });

  it("workflow stores an idempotency key resolver for event-triggered workflows", () => {
    const key = (
      userOnboardingWorkflow.idempotencyKey as (e: { payload: { userId: string } }) => string
    )({
      payload: { userId: "user_123" },
    });
    expect(key).toBe("onboarding:user_123");
  });
});

describe("workflow-runner", () => {
  function makeAppendOnlyCtx() {
    return { unsafeAppendEvent: mock().mockResolvedValue(undefined) };
  }

  it("startAndRunWorkflow writes run.started with Q7 snapshot fingerprint, then runs the pipeline to completion when no suspension", async () => {
    const workflow = defineWorkflow({
      name: "demo-sync",
      trigger: { kind: "event", eventType: "demo.fired" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });
    const ctx = makeAppendOnlyCtx();

    const result = await startAndRunWorkflow({
      runId: "wf-demo-sync-1",
      workflow,
      triggerEvent: { aggregateId: "agg_1", type: "demo.fired", payload: {} } as never,
      handlerCtx: ctx as never,
    });

    expect(result.outcome).toBe("completed");
    expect(ctx.unsafeAppendEvent).toHaveBeenCalledTimes(2);
    const started = ctx.unsafeAppendEvent.mock.calls[0]![0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(started.type).toBe("kumiko:system:workflow.run-started");
    expect(started.payload["definitionFingerprint"]).toBe(computeDefinitionFingerprint(workflow));
    expect(started.payload["triggerEventType"]).toBe("demo.fired");
    const completed = ctx.unsafeAppendEvent.mock.calls[1]![0] as { type: string };
    expect(completed.type).toBe("kumiko:system:workflow.run-completed");
  });

  it("startAndRunWorkflow returns outcome=suspended and stamps fingerprint into the waiting event", async () => {
    const workflow = defineWorkflow({
      name: "demo-wait",
      trigger: { kind: "event", eventType: "demo.fired" },
      steps: pipeline(({ r }) => [
        r.step.wait({ for: "PT1H" }),
        r.step.return({ isSuccess: true, data: undefined }),
      ]),
    });
    const ctx = makeAppendOnlyCtx();

    const result = await startAndRunWorkflow({
      runId: "wf-demo-wait-1",
      workflow,
      triggerEvent: { aggregateId: "agg_1", type: "demo.fired", payload: {} } as never,
      handlerCtx: ctx as never,
    });

    expect(result.outcome).toBe("suspended");
    // run.started + workflow.step.waiting — no run-completed yet
    expect(ctx.unsafeAppendEvent).toHaveBeenCalledTimes(2);
    const waiting = ctx.unsafeAppendEvent.mock.calls[1]![0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(waiting.type).toBe("kumiko:system:workflow.step.waiting");
    expect(waiting.payload["definitionFingerprint"]).toBe(computeDefinitionFingerprint(workflow));
  });

  it("idempotencyKey ends up in the run.started payload when provided", async () => {
    const workflow = defineWorkflow({
      name: "demo-idem",
      trigger: { kind: "event", eventType: "demo.fired" },
      idempotencyKey: ({ payload }) => `id:${(payload as { x: string }).x}`,
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });
    const ctx = makeAppendOnlyCtx();

    await startAndRunWorkflow({
      runId: "wf-demo-idem-1",
      workflow,
      triggerEvent: { aggregateId: "agg_1", type: "demo.fired", payload: { x: "abc" } } as never,
      idempotencyKey: "id:abc",
      handlerCtx: ctx as never,
    });

    const started = ctx.unsafeAppendEvent.mock.calls[0]![0] as { payload: Record<string, unknown> };
    expect(started.payload["idempotencyKey"]).toBe("id:abc");
  });
});

describe("userOnboardingWorkflow (end-to-end, in-memory)", () => {
  it("suspends on the first wait, then resume-loop runs it through to completion", async () => {
    const ctx = { unsafeAppendEvent: mock().mockResolvedValue(undefined) };

    const result = await startAndRunWorkflow({
      runId: "wf-onboarding-active-42",
      workflow: userOnboardingWorkflow as unknown as WorkflowDefinition,
      triggerEvent: {
        aggregateId: "agg_user_42",
        type: "user.signed-up",
        payload: { email: "x@example.com", userId: "active-42" },
      } as never,
      idempotencyKey: "onboarding:active-42",
      handlerCtx: ctx as never,
    });

    expect(result.outcome).toBe("suspended");
    // Calls: run.started, mail.send dispatch-requested, workflow.step.waiting
    expect(ctx.unsafeAppendEvent).toHaveBeenCalledTimes(3);
    const startedCall = ctx.unsafeAppendEvent.mock.calls[0]![0] as { type: string };
    const mailCall = ctx.unsafeAppendEvent.mock.calls[1]![0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    const waitingCall = ctx.unsafeAppendEvent.mock.calls[2]![0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(startedCall.type).toBe("kumiko:system:workflow.run-started");
    expect(mailCall.type).toBe("kumiko:system:step.dispatch-requested");
    expect((mailCall.payload as { stepKind: string }).stepKind).toBe("mail.send");
    expect(waitingCall.type).toBe("kumiko:system:workflow.step.waiting");
    expect(waitingCall.payload["definitionFingerprint"]).toBe(
      computeDefinitionFingerprint(userOnboardingWorkflow as unknown as WorkflowDefinition),
    );

    // Re-feed the run through the resume-loop using the fingerprint the
    // waiting event carries — the loop runs the rest of the pipeline.
    const triggerSnapshot = {
      aggregateId: waitingCall.payload["triggerAggregateId"] as string,
      type: waitingCall.payload["triggerEventType"] as string,
      payload: waitingCall.payload["triggerPayload"],
    };
    const suspendedRun: SuspendableRun = {
      runId: "wf-onboarding-active-42",
      workflowName: "user-onboarding",
      stepIndex: waitingCall.payload["stepIndex"] as number,
      wakeAt: Temporal.Now.instant().subtract({ seconds: 1 }).toString(),
      suspensionEventType: "kumiko:system:workflow.step.waiting",
      workflow: userOnboardingWorkflow as unknown as WorkflowDefinition,
      triggerEvent: triggerSnapshot as never,
      definitionFingerprint: waitingCall.payload["definitionFingerprint"] as string,
    };

    const resumeCtx = { unsafeAppendEvent: mock().mockResolvedValue(undefined) };
    const count = await runResumeLoop(
      createInMemorySuspendedRunFetcher([suspendedRun]),
      resumeCtx as never,
    );

    expect(count).toBe(1);
    // Resume sequence: RESUMED, branch fires the tips-mail (engaged=true
    // because userId starts with "active-"), second WAITING for P7D.
    // The run is suspended again before the webhook, so no RUN_COMPLETED
    // yet — this is one resume-cycle, not the whole workflow.
    const resumeTypes = resumeCtx.unsafeAppendEvent.mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    );
    expect(resumeTypes).toEqual([
      "kumiko:system:workflow.step.resumed",
      "kumiko:system:step.dispatch-requested",
      "kumiko:system:workflow.step.waiting",
    ]);
    const tipsMail = resumeCtx.unsafeAppendEvent.mock.calls[1]![0] as {
      payload: { spec: { subject: string } };
    };
    expect(tipsMail.payload.spec.subject).toBe("Engagement tips");
  });

  it("not-engaged path picks the reminder branch", async () => {
    const ctx = { unsafeAppendEvent: mock().mockResolvedValue(undefined) };
    await startAndRunWorkflow({
      runId: "wf-onboarding-cold-1",
      workflow: userOnboardingWorkflow as unknown as WorkflowDefinition,
      triggerEvent: {
        aggregateId: "agg_user_cold",
        type: "user.signed-up",
        payload: { email: "cold@example.com", userId: "cold-1" },
      } as never,
      handlerCtx: ctx as never,
    });
    const waiting = ctx.unsafeAppendEvent.mock.calls[2]![0] as { payload: Record<string, unknown> };
    const suspendedRun: SuspendableRun = {
      runId: "wf-onboarding-cold-1",
      workflowName: "user-onboarding",
      stepIndex: waiting.payload["stepIndex"] as number,
      wakeAt: Temporal.Now.instant().subtract({ seconds: 1 }).toString(),
      suspensionEventType: "kumiko:system:workflow.step.waiting",
      workflow: userOnboardingWorkflow as unknown as WorkflowDefinition,
      triggerEvent: {
        aggregateId: waiting.payload["triggerAggregateId"] as string,
        type: waiting.payload["triggerEventType"] as string,
        payload: waiting.payload["triggerPayload"],
      } as never,
      definitionFingerprint: waiting.payload["definitionFingerprint"] as string,
    };
    const resumeCtx = { unsafeAppendEvent: mock().mockResolvedValue(undefined) };
    await runResumeLoop(createInMemorySuspendedRunFetcher([suspendedRun]), resumeCtx as never);

    const reminderMail = resumeCtx.unsafeAppendEvent.mock.calls[1]![0] as {
      payload: { spec: { subject: string } };
    };
    expect(reminderMail.payload.spec.subject).toBe("Getting started");
  });
});

describe("computeDefinitionFingerprint", () => {
  it("returns the same fingerprint for the same definition", () => {
    const a = defineWorkflow({
      name: "wf",
      trigger: { kind: "event", eventType: "x" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });
    const b = defineWorkflow({
      name: "wf",
      trigger: { kind: "event", eventType: "x" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });
    expect(computeDefinitionFingerprint(a)).toBe(computeDefinitionFingerprint(b));
  });

  it("returns a different fingerprint when the pipeline source changes", () => {
    const a = defineWorkflow({
      name: "wf",
      trigger: { kind: "event", eventType: "x" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });
    const b = defineWorkflow({
      name: "wf",
      trigger: { kind: "event", eventType: "x" },
      steps: pipeline(({ r }) => [
        r.step.compute("noop", () => 1),
        r.step.return({ isSuccess: true, data: undefined }),
      ]),
    });
    expect(computeDefinitionFingerprint(a)).not.toBe(computeDefinitionFingerprint(b));
  });

  it("returns a different fingerprint when the trigger changes", () => {
    const a = defineWorkflow({
      name: "wf",
      trigger: { kind: "event", eventType: "x" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });
    const b = defineWorkflow({
      name: "wf",
      trigger: { kind: "event", eventType: "y" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });
    expect(computeDefinitionFingerprint(a)).not.toBe(computeDefinitionFingerprint(b));
  });
});

describe("event-trigger", () => {
  it("registerEventTrigger creates MSP for event-kind workflows", () => {
    const registrations: unknown[] = [];
    const mockRegistrar = {
      multiStreamProjection: (def: unknown) => {
        registrations.push(def);
      },
    };

    registerEventTrigger(
      mockRegistrar as never,
      userOnboardingWorkflow as unknown as WorkflowDefinition,
    );

    expect(registrations).toHaveLength(1);
    const msp = registrations[0] as Record<string, unknown>;
    expect(msp["name"]).toBe("workflow-user-onboarding");
    expect(typeof (msp["apply"] as Record<string, unknown>)["user.signed-up"]).toBe("function");
  });

  it("registerEventTrigger skips non-event workflows", () => {
    const registrations: unknown[] = [];
    const mockRegistrar = {
      multiStreamProjection: (def: unknown) => {
        registrations.push(def);
      },
    };

    registerEventTrigger(
      mockRegistrar as never,
      dailyReportWorkflow as unknown as WorkflowDefinition,
    );

    expect(registrations).toHaveLength(0);
  });

  it("userOnboardingSteps is a valid pipeline", () => {
    expect(userOnboardingSteps.__kind).toBe("pipeline");
    expect(typeof userOnboardingSteps.build).toBe("function");
  });
});

describe("cron-scheduler", () => {
  it("nextCronDate computes the next run time", () => {
    const base = Temporal.Instant.from("2025-06-01T00:00:00Z");
    const next = nextCronDate("30 9 * * *", base);
    expect(next).not.toBeNull();
    const zdt = next!.toZonedDateTimeISO("UTC");
    expect(zdt.hour).toBe(9);
    expect(zdt.minute).toBe(30);
    expect(zdt.day).toBe(1);
  });

  it("nextCronDate returns null for invalid cron expressions", () => {
    expect(nextCronDate("invalid", Temporal.Now.instant())).toBeNull();
    expect(nextCronDate("", Temporal.Now.instant())).toBeNull();
  });

  it("nextCronDate advances to next day if time already passed", () => {
    const base = Temporal.Instant.from("2025-06-01T10:00:00Z");
    const next = nextCronDate("30 9 * * *", base);
    const zdt = next!.toZonedDateTimeISO("UTC");
    // 09:30 already passed on June 1 → next is June 2 at 09:30
    expect(zdt.day).toBe(2);
    expect(zdt.hour).toBe(9);
    expect(zdt.minute).toBe(30);
  });

  it("runDueCronWorkflows skips not-yet-due workflows", async () => {
    const wf = defineWorkflow({
      name: "test-daily",
      trigger: { kind: "cron", schedule: "0 9 * * *" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });

    const handlerCtx = { unsafeAppendEvent: mock() };
    const lastRuns = new Map<string, Temporal.Instant>();
    const now = Temporal.Instant.from("2025-06-01T08:00:00Z");

    const count = await runDueCronWorkflows(
      [wf as CronWorkflow],
      lastRuns,
      now,
      handlerCtx as never,
    );

    expect(count).toBe(0);
    expect(handlerCtx.unsafeAppendEvent).not.toHaveBeenCalled();
  });

  it("runDueCronWorkflows runs due workflows through the full start path", async () => {
    const wf = defineWorkflow({
      name: "test-daily",
      trigger: { kind: "cron", schedule: "0 9 * * *" },
      steps: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: undefined })]),
    });

    const handlerCtx = { unsafeAppendEvent: mock().mockResolvedValue(undefined) };
    const lastRuns = new Map<string, Temporal.Instant>();
    const lastRun = Temporal.Instant.from("2025-05-31T08:00:00Z");
    lastRuns.set("test-daily", lastRun);
    const now = Temporal.Instant.from("2025-06-01T09:01:00Z");

    const count = await runDueCronWorkflows(
      [wf as CronWorkflow],
      lastRuns,
      now,
      handlerCtx as never,
    );

    expect(count).toBe(1);
    // run.started + run-completed (no suspension, pipeline returns immediately).
    expect(handlerCtx.unsafeAppendEvent).toHaveBeenCalledTimes(2);
    const started = handlerCtx.unsafeAppendEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(started["type"]).toBe("kumiko:system:workflow.run-started");
    const completed = handlerCtx.unsafeAppendEvent.mock.calls[1]![0] as Record<string, unknown>;
    expect(completed["type"]).toBe("kumiko:system:workflow.run-completed");
  });
});

describe("resume-loop", () => {
  it("returns 0 when no suspended runs exist", async () => {
    const fetchRuns = createInMemorySuspendedRunFetcher([]);
    const handlerCtx = { unsafeAppendEvent: mock() };

    const count = await runResumeLoop(fetchRuns, handlerCtx as never);

    expect(count).toBe(0);
    expect(handlerCtx.unsafeAppendEvent).not.toHaveBeenCalled();
  });

  it("resumes a suspended run", async () => {
    const workflow = makeWaitWorkflow("test-workflow");
    const suspendedRun: SuspendableRun = {
      runId: "wf-test-run_123",
      workflowName: "test-workflow",
      stepIndex: 0,
      wakeAt: Temporal.Now.instant().subtract({ seconds: 1 }).toString(),
      suspensionEventType: "kumiko:system:workflow.step.waiting",
      workflow,
      triggerEvent: { aggregateId: "agg_1", type: "demo.fired", payload: {} } as never,
      definitionFingerprint: computeDefinitionFingerprint(workflow),
    };

    const fetchRuns = createInMemorySuspendedRunFetcher([suspendedRun]);
    const handlerCtx = { unsafeAppendEvent: mock().mockResolvedValue(undefined) };

    const count = await runResumeLoop(fetchRuns, handlerCtx as never);

    expect(count).toBe(1);
    expect(handlerCtx.unsafeAppendEvent).toHaveBeenCalledTimes(2);
    expect(handlerCtx.unsafeAppendEvent).toHaveBeenNthCalledWith(1, {
      aggregateId: "wf-test-run_123",
      aggregateType: "workflow-run",
      type: "kumiko:system:workflow.step.resumed",
      payload: { stepIndex: 0, retryAttempt: undefined },
    });
    expect(handlerCtx.unsafeAppendEvent).toHaveBeenNthCalledWith(2, {
      aggregateId: "wf-test-run_123",
      aggregateType: "workflow-run",
      type: "kumiko:system:workflow.run-completed",
      payload: { stepIndex: 0 },
    });
  });

  it("fails loud (RUN_FAILED + reason workflow_definition_changed) when the fingerprint diverges", async () => {
    const workflow = makeWaitWorkflow("test-workflow-drift");
    const suspendedRun: SuspendableRun = {
      runId: "wf-drift-run",
      workflowName: "test-workflow-drift",
      stepIndex: 0,
      wakeAt: Temporal.Now.instant().subtract({ seconds: 1 }).toString(),
      suspensionEventType: "kumiko:system:workflow.step.waiting",
      workflow,
      triggerEvent: { aggregateId: "agg_y", type: "demo.fired", payload: {} } as never,
      definitionFingerprint: "stale-fingerprint-from-an-older-deploy",
    };

    const fetchRuns = createInMemorySuspendedRunFetcher([suspendedRun]);
    const handlerCtx = { unsafeAppendEvent: mock().mockResolvedValue(undefined) };

    const count = await runResumeLoop(fetchRuns, handlerCtx as never);

    expect(count).toBe(0);
    expect(handlerCtx.unsafeAppendEvent).toHaveBeenCalledTimes(1);
    const failed = handlerCtx.unsafeAppendEvent.mock.calls[0]![0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(failed.type).toBe("kumiko:system:workflow.run-failed");
    expect(failed.payload["reason"]).toBe("workflow_definition_changed");
    expect(failed.payload["error"]).toContain("definition changed");
  });

  it("skips a run silently when the resume-claim hits VersionConflictError", async () => {
    const workflow = makeWaitWorkflow("test-workflow-conflict");
    const suspendedRun: SuspendableRun = {
      runId: "wf-conflict-run",
      workflowName: "test-workflow-conflict",
      stepIndex: 0,
      wakeAt: Temporal.Now.instant().subtract({ seconds: 1 }).toString(),
      suspensionEventType: "kumiko:system:workflow.step.waiting",
      workflow,
      triggerEvent: { aggregateId: "agg_x", type: "demo.fired", payload: {} } as never,
      definitionFingerprint: computeDefinitionFingerprint(workflow),
    };

    const fetchRuns = createInMemorySuspendedRunFetcher([suspendedRun]);
    const handlerCtx = {
      unsafeAppendEvent: mock()
        .mockRejectedValueOnce(new VersionConflictError("wf-conflict-run", 1))
        .mockResolvedValue(undefined),
    };

    const count = await runResumeLoop(fetchRuns, handlerCtx as never);

    expect(count).toBe(0);
    expect(handlerCtx.unsafeAppendEvent).toHaveBeenCalledTimes(1);
    expect((handlerCtx.unsafeAppendEvent.mock.calls[0]![0] as { type: string }).type).toBe(
      "kumiko:system:workflow.step.resumed",
    );
  });

  it("createInMemorySuspendedRunFetcher returns runs with workflow intact", async () => {
    const workflow = makeReturnOnlyWorkflow("test-fetcher");
    const run: SuspendableRun = {
      runId: "wf-test-pipeline",
      workflowName: "test-fetcher",
      stepIndex: 0,
      wakeAt: "2025-06-01T00:00:00Z",
      workflow,
      triggerEvent: { aggregateId: "a", type: "demo.fired", payload: {} } as never,
      suspensionEventType: "kumiko:system:workflow.step.waiting",
    };

    const fetchRuns = createInMemorySuspendedRunFetcher([run]);
    const result = await fetchRuns();

    expect(result).toHaveLength(1);
    expect(typeof result[0]!.workflow.pipelineDef.build).toBe("function");
  });
});
