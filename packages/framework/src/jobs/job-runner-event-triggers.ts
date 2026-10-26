import type { JobDefinition } from "@cosmicdrift/kumiko-types/config";
import type { JobTriggerEvent } from "@cosmicdrift/kumiko-types/handlers";
import type { Tracer } from "@cosmicdrift/kumiko-types/observability";
import type { JobsOptions, Queue } from "bullmq";
import { requestContext } from "../api/request-context.ts";
import type { JobRunIn, Registry, SessionUser } from "../engine/types/index.ts";
import {
  buildRetryBullOpts,
  captureTraceContext,
  catchUpJobId,
  eventTriggerMatches,
  stampGatedWriteOrigin,
  TRACE_CONTEXT_KEY,
} from "./job-runner-helpers.ts";
import {
  announceQueued,
  isOverPerTenantLimit,
  type JobRunnerScope,
  laneForJob,
} from "./job-runner-scope.ts";
import type { JobRunner } from "./job-runner-types.ts";
import { resolveMaxPerTenant } from "./max-per-tenant.ts";

export type JobEventTriggerDeps = {
  readonly scope: JobRunnerScope;
  readonly queues: Readonly<Record<JobRunIn, Queue>>;
  readonly tracer: Tracer;
  readonly allJobs: ReturnType<Registry["getAllJobs"]>;
};

export function createJobEventTriggers(
  deps: JobEventTriggerDeps,
): Pick<JobRunner, "handleEvent" | "handleCatchUpEvent"> {
  const { scope, queues, tracer, allJobs } = deps;

  async function enqueueEventTriggeredJob(
    name: string,
    jobDef: JobDefinition,
    eventName: string,
    payload: Record<string, unknown>,
    user: SessionUser | undefined,
    triggerEvent: JobTriggerEvent | undefined,
    jobId?: string,
  ): Promise<void> {
    // Same correlation propagation as dispatch(): the job keeps the causal chain.
    const traceCtx = captureTraceContext(tracer);
    const reqCtx = requestContext.get();
    const data: Record<string, unknown> = { ...payload };
    if (user) {
      data["_tenantId"] = user.tenantId;
      data["_triggeredById"] = user.id;
    }
    // _triggerName tells a multi-trigger handler which trigger fired; set for single triggers too.
    data["_triggerName"] = eventName;
    if (triggerEvent) data["_triggerEvent"] = triggerEvent;
    if (traceCtx) data[TRACE_CONTEXT_KEY] = traceCtx;
    if (reqCtx?.correlationId) data["_correlationId"] = reqCtx.correlationId;
    // Same maxPerTenant guard as dispatch — events that fan into many
    // jobs must respect the per-tenant cap or the limit is one-sided.
    const maxPerTenant = resolveMaxPerTenant(jobDef);
    if (maxPerTenant?.onLimit === "skip" && user?.tenantId !== undefined) {
      if (await isOverPerTenantLimit(scope, name, String(user.tenantId), maxPerTenant.limit)) {
        // skip: onLimit "skip" drops this trigger on purpose while the tenant is at its cap.
        return;
      }
    }
    stampGatedWriteOrigin(data);
    const bullOpts: JobsOptions = { ...buildRetryBullOpts(jobDef) };
    if (jobId !== undefined) bullOpts.jobId = jobId;
    // Route to the job's declared lane, not a fixed queue.
    const job = await queues[laneForJob(jobDef)].add(name, data, bullOpts);
    await announceQueued(scope, name, jobDef, job, data);
  }

  return {
    async handleEvent(
      eventName: string,
      payload: Record<string, unknown>,
      user?: SessionUser,
      triggerEvent?: JobTriggerEvent,
    ): Promise<void> {
      for (const [name, jobDef] of allJobs) {
        if (!("on" in jobDef.trigger) || jobDef.trigger.catchUp) continue;
        // skip: other trigger types (cron, manual) do not respond to events;
        // catchUp jobs are fed by their own consumer (handleCatchUpEvent).
        if (!eventTriggerMatches(jobDef.trigger, eventName, payload)) continue;
        await enqueueEventTriggeredJob(name, jobDef, eventName, payload, user, triggerEvent);
      }
    },
    async handleCatchUpEvent(
      jobName: string,
      eventName: string,
      payload: Record<string, unknown>,
      user: SessionUser,
      triggerEvent: JobTriggerEvent,
    ): Promise<void> {
      const jobDef = allJobs.get(jobName);
      // A stale consumer for a removed or changed job, or an event the trigger filters out, runs nothing.
      if (
        jobDef &&
        "on" in jobDef.trigger &&
        jobDef.trigger.catchUp &&
        eventTriggerMatches(jobDef.trigger, eventName, payload)
      ) {
        await enqueueEventTriggeredJob(
          jobName,
          jobDef,
          eventName,
          payload,
          user,
          triggerEvent,
          catchUpJobId(jobName, triggerEvent.id),
        );
      }
    },
  };
}
