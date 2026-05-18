// cron-scheduler — schedules and triggers cron-based workflows.
//
// Each tick (default 60s) checks whether a cron workflow is due and runs it
// through the same `startAndRunWorkflow` path the event-trigger uses.
// Production setups should swap the tick-loop for a persistent scheduler
// (pg_cron, BullMQ) — the sample provides Bun.Timer + a manual entrypoint.

import type { HandlerContext, WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { v4 as uuid } from "uuid";
import { startAndRunWorkflow } from "./workflow-runner";

export type CronWorkflow = WorkflowDefinition & {
  readonly trigger: { readonly kind: "cron"; readonly schedule: string };
};

// Parse a cron expression in the format "minute hour * * *" and return
// the next scheduled Instant (UTC), or null if invalid. Wildcards for
// day/month/weekday are accepted; numeric minute+hour required.
export function nextCronDate(schedule: string, since: Temporal.Instant): Temporal.Instant | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [minStr, hourStr] = parts;
  if (minStr === undefined || hourStr === undefined) return null;

  const cronMin = parseInt(minStr, 10);
  const cronHour = parseInt(hourStr, 10);
  if (Number.isNaN(cronMin) || Number.isNaN(cronHour)) return null;

  // Move to the same-day candidate at cronHour:cronMin (UTC), then bump
  // by one day until strictly after `since`.
  let candidate = since
    .toZonedDateTimeISO("UTC")
    .with({ hour: cronHour, minute: cronMin, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
  while (Temporal.Instant.compare(candidate.toInstant(), since) <= 0) {
    candidate = candidate.add({ days: 1 });
  }
  return candidate.toInstant();
}

/**
 * Check if a cron workflow is due to run and execute it via the shared
 * start-and-run path. Returns the number of workflow runs started.
 */
export async function runDueCronWorkflows(
  workflows: readonly CronWorkflow[],
  lastRuns: Map<string, Temporal.Instant>,
  now: Temporal.Instant,
  handlerCtx: HandlerContext,
): Promise<number> {
  let count = 0;

  for (const wf of workflows) {
    const lastRun = lastRuns.get(wf.name) ?? now;
    const next = nextCronDate(wf.trigger.schedule, lastRun);

    if (next && Temporal.Instant.compare(next, now) <= 0) {
      const runId = `wf-${wf.name}-cron-${uuid()}`;
      await startAndRunWorkflow({
        runId,
        workflow: wf,
        triggerEvent: { aggregateId: runId, type: "cron", payload: {} } as never,
        handlerCtx,
      });
      lastRuns.set(wf.name, now);
      count++;
    }
  }

  return count;
}

/**
 * Create a Bun.Timer-based cron scheduler that periodically checks for
 * due workflows and runs them.
 */
export function startCronScheduler(
  workflows: readonly CronWorkflow[],
  handlerCtx: HandlerContext,
  intervalMs = 60_000,
): { stop: () => void } {
  const lastRuns = new Map<string, Temporal.Instant>();
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    if (running) return;
    running = true;
    try {
      await runDueCronWorkflows(workflows, lastRuns, Temporal.Now.instant(), handlerCtx);
    } catch {
      // Logged by the caller
    } finally {
      running = false;
    }
  }

  timer = setInterval(tick, intervalMs);
  void tick();

  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
