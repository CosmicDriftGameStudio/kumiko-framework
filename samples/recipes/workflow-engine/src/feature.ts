// workflow-engine Sample — M.4 Tier-3 step-vocabulary showcase.
//
// Demonstrates defineWorkflow with wait, branch, mail.send, webhook.send,
// retry, and the workflow-run lifecycle. Each workflow below is a real,
// runnable pipeline — no empty `build: () => []` stubs. The
// integration-tests in __tests__/ exercise the suspension/resume cycle
// against the in-memory fetcher and (separately) the postgres event-store.
//
// Mounting:
//   - Event-triggered workflows register an MSP via `registerEventTrigger`
//     (see feature() below). The MSP starts + runs the pipeline up to the
//     first suspension; the resume-loop wakes it later.
//   - Cron-triggered workflows are started by the `cron-scheduler` tick.
//
// M.4 Limitations (Followups, will land with M.5 / future slices):
//   - The MSP apply-ctx exposes `unsafeAppendEvent` + `db` but not the
//     full HandlerContext surface. `r.step.read.findOne` works (db is
//     present), `r.step.callFeature` does NOT yet (no `write`/`writeAs`
//     on apply-ctx). Pipelines should stick to compute / branch / wait /
//     retry / mail.send / webhook.send for now.
//   - The fetcher reads every suspension row whose wakeAt has expired
//     (no `workflow_run_pending` read-side projection yet). Concurrency
//     is safe via the event-store version-conflict path; performance is
//     adequate for the demo, not for high-volume production.

import type { WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { defineFeature, defineWorkflow, pipeline } from "@cosmicdrift/kumiko-framework/engine";
import { registerEventTrigger } from "./event-trigger";

/**
 * User-onboarding workflow: welcome-mail → wait 1 day → branch on a
 * computed engagement flag → either tips or reminder → wait 7 days →
 * webhook to the CRM. Triggered by `user.signed-up`, deduped per userId.
 *
 * The engagement-flag is computed inline (no read.findOne in M.4 yet —
 * see Limitations above). A real app would resolve the flag from the
 * user-store via a Tier-1 read step once the apply-ctx → HandlerContext
 * bridge lands.
 */
export const userOnboardingWorkflow: WorkflowDefinition<{ email: string; userId: string }, void> =
  defineWorkflow({
    name: "user-onboarding",
    trigger: { kind: "event", eventType: "user.signed-up" },
    idempotencyKey: ({ payload }) => `onboarding:${payload.userId}`,

    steps: pipeline<{ email: string; userId: string }, void>(({ r }) => [
      r.step.mail.send({
        to: (ctx) => (ctx.event.payload as { email: string }).email,
        subject: "Welcome!",
        body: "Thanks for signing up — we'll check in soon.",
        mode: "deferred",
      }),

      r.step.wait({ for: "P1D" }),

      // Engagement gate: demo-only inline flag. In a production sample this
      // would be `r.step.read.findOne("user", { ... })` followed by a
      // branch on `lastSeenAt`; deferred to the M.5 read-bridge.
      r.step.compute("engaged", (ctx) => {
        const userId = (ctx.event.payload as { userId: string }).userId;
        return userId.startsWith("active-");
      }),

      r.step.branch({
        if: (ctx) => (ctx.steps["engaged"] as boolean) === true,
        onTrue: [
          r.step.mail.send({
            to: (ctx) => (ctx.event.payload as { email: string }).email,
            subject: "Engagement tips",
            body: "You're off to a great start — try these next.",
            mode: "deferred",
          }),
        ],
        onFalse: [
          r.step.mail.send({
            to: (ctx) => (ctx.event.payload as { email: string }).email,
            subject: "Getting started",
            body: "Need a hand? Here's how to begin.",
            mode: "deferred",
          }),
        ],
      }),

      r.step.wait({ for: "P7D" }),

      r.step.webhook.send({
        url: "https://hooks.example.com/crm-onboarding",
        method: "POST",
        body: (ctx) => ({
          userId: (ctx.event.payload as { userId: string }).userId,
          stage: "day8",
        }),
        mode: "deferred",
      }),

      r.step.return({ resolver: { isSuccess: true, data: undefined } }),
    ]),
  });

/**
 * Retry-with-backoff workflow: wraps a deferred webhook in retry(3,
 * exponential). The retry step suspends the run between attempts and
 * the resume-loop re-enters it after the backoff window.
 */
export const resilientWebhookWorkflow: WorkflowDefinition<
  { data: unknown; webhookUrl: string },
  void
> = defineWorkflow({
  name: "resilient-webhook",
  trigger: { kind: "event", eventType: "data.processed" },

  steps: pipeline<{ data: unknown; webhookUrl: string }, void>(({ r }) => [
    r.step.retry({
      times: 3,
      backoff: "exponential",
      do: [
        r.step.webhook.send({
          url: (ctx) => (ctx.event.payload as { webhookUrl: string }).webhookUrl,
          body: (ctx) => (ctx.event.payload as { data: unknown }).data,
          mode: "deferred",
        }),
      ],
    }),
    r.step.return({ resolver: { isSuccess: true, data: undefined } }),
  ]),
});

/**
 * Daily-report workflow: cron-triggered, single deferred webhook.
 */
export const dailyReportWorkflow: WorkflowDefinition<void, void> = defineWorkflow({
  name: "daily-report",
  trigger: { kind: "cron", schedule: "0 9 * * *" },

  steps: pipeline<void, void>(({ r }) => [
    r.step.webhook.send({
      url: "https://hooks.example.com/daily-report",
      body: { ts: new Date().toISOString() },
      mode: "deferred",
    }),
    r.step.return({ resolver: { isSuccess: true, data: undefined } }),
  ]),
});

/**
 * Workflow-engine feature registers MSP subscriptions for every event-
 * triggered workflow. Cron-triggered workflows are picked up by the
 * cron-scheduler.tick() in production wiring; the feature itself doesn't
 * own them.
 */
export const workflowEngineFeature = defineFeature("workflowEngine", (r) => {
  registerEventTrigger(r, userOnboardingWorkflow);
  registerEventTrigger(r, resilientWebhookWorkflow);
  // dailyReportWorkflow is cron-triggered — skip MSP registration
});

/**
 * Compat-Export — the unit-test file references this. It's just the
 * onboarding workflow's pipelineDef pulled out so the test can assert
 * its shape independently from the workflow definition.
 */
export const userOnboardingSteps = userOnboardingWorkflow.pipelineDef;
