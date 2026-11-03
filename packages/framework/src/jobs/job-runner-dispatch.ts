import type { JobDefinition } from "@cosmicdrift/kumiko-types/config";
import type { Tracer } from "@cosmicdrift/kumiko-types/observability";
import type { Queue } from "bullmq";
import { requestContext } from "../api/request-context.ts";
import {
  buildRetryBullOpts,
  captureTraceContext,
  stampGatedWriteOrigin,
  TRACE_CONTEXT_KEY,
} from "./job-runner-helpers.ts";
import { announceDropped, type JobRunnerScope } from "./job-runner-scope.ts";
import type { JobMeta } from "./job-runner-types.ts";

// case "sequential" is rejected at boot — see createJobRunner. Once the OSS-compatible
// implementation lands (per-name Redis lock), re-add the dispatch branch here.
export async function applyConcurrencyMode(
  scope: JobRunnerScope,
  targetQueue: Queue,
  jobName: string,
  jobDef: JobDefinition,
  bullOpts: Record<string, unknown>,
): Promise<"skipped" | undefined> {
  switch (jobDef.concurrency ?? "parallel") {
    case "skip": {
      const active = await targetQueue.getActive();
      const waiting = await targetQueue.getWaiting();
      const isRunning = [...active, ...waiting].some((j) => j.name === jobName);
      return isRunning ? "skipped" : undefined;
    }
    case "replace": {
      const waiting = await targetQueue.getWaiting();
      for (const j of waiting) {
        if (j.name === jobName && j.id) {
          await j.remove();
          await announceDropped(scope, jobName, jobDef, j.id, j.data);
        }
      }
      return undefined;
    }
    case "debounce": {
      bullOpts["debounce"] = { id: jobName, ttl: jobDef.debounceMs ?? 5000 };
      return undefined;
    }
    default:
      return undefined;
  }
}

// Fills bullOpts from the job definition and meta, and returns the job data with the _-prefixed meta.
export function buildEnqueueInputs(
  tracer: Tracer,
  jobDef: JobDefinition,
  payload: Record<string, unknown> | undefined,
  meta: JobMeta | undefined,
  bullOpts: Record<string, unknown>,
): Record<string, unknown> {
  Object.assign(bullOpts, buildRetryBullOpts(jobDef));
  if (jobDef.timeout) bullOpts["timeout"] = jobDef.timeout;
  if (meta?.priority !== undefined) bullOpts["priority"] = meta.priority;
  if (meta?.jobId !== undefined) bullOpts["jobId"] = meta.jobId;

  const data: Record<string, unknown> = { ...payload };
  if (meta?.triggeredById !== undefined) data["_triggeredById"] = meta.triggeredById;
  if (meta?.payload !== undefined) data["_payload"] = meta.payload;
  // Carry the enqueuing span context into the worker so job.execute shows as a child of the caller.
  const traceCtx = captureTraceContext(tracer);
  if (traceCtx) data[TRACE_CONTEXT_KEY] = traceCtx;
  // The worker re-enters requestContext.run with this value so writes during the job stamp the
  // same correlation as the HTTP request that scheduled it.
  const reqCtx = requestContext.get();
  if (reqCtx?.correlationId) data["_correlationId"] = reqCtx.correlationId;
  stampGatedWriteOrigin(data);
  return data;
}
