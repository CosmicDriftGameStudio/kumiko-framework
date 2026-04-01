import { type Job, Queue, Worker } from "bullmq";
import type { PipelineContext, Registry } from "../engine/types";

export type JobLogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: Date;
};

export type JobMeta = {
  triggeredById?: number | undefined;
  payload?: string | undefined;
};

export type JobRunner = {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatch(jobName: string, payload?: Record<string, unknown>, meta?: JobMeta): Promise<string>;
};

export type JobRunnerOptions = {
  registry: Registry;
  context: PipelineContext;
  redisUrl: string;
  queueName?: string;
  onJobStart?: (jobName: string, jobId: string, meta: JobMeta) => void;
  onJobComplete?: (jobName: string, jobId: string, duration: number, logs: JobLogEntry[]) => void;
  onJobFailed?: (jobName: string, jobId: string, error: string, logs: JobLogEntry[]) => void;
};

function parseRedisOpts(url: string): { host: string; port: number; db?: number | undefined } {
  const parsed = new URL(url);
  const result: { host: string; port: number; db?: number | undefined } = {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
  };
  if (parsed.pathname.length > 1) {
    result.db = Number(parsed.pathname.slice(1));
  }
  return result;
}

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const { registry, context, redisUrl } = options;
  const queueName = options.queueName ?? "kumiko-jobs";
  const redisOpts = parseRedisOpts(redisUrl);

  const allJobs = registry.getAllJobs();
  const queue = new Queue(queueName, { connection: redisOpts });
  let worker: Worker | null = null;

  async function handleJob(bullJob: Job): Promise<void> {
    const jobName = bullJob.name;
    const jobDef = allJobs.get(jobName);
    if (!jobDef) {
      throw new Error(`Unknown job: ${jobName}`);
    }

    const jobId = bullJob.id ?? "unknown";
    const startTime = Date.now();
    const logs: JobLogEntry[] = [];

    // Extract meta from job data
    const rawData = bullJob.data as Record<string, unknown>;
    const meta: JobMeta = {
      triggeredById: rawData["_triggeredById"] as number | undefined,
      payload: rawData["_payload"] as string | undefined,
    };

    // Build handler payload (without internal meta fields)
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (!k.startsWith("_")) payload[k] = v;
    }

    const jobContext: PipelineContext = {
      ...context,
      log: (message: string) => {
        logs.push({ level: "info", message, timestamp: new Date() });
      },
      warn: (message: string) => {
        logs.push({ level: "warn", message, timestamp: new Date() });
      },
      logError: (message: string) => {
        logs.push({ level: "error", message, timestamp: new Date() });
      },
    };

    await options.onJobStart?.(jobName, jobId, meta);

    try {
      await jobDef.handler(payload, jobContext);

      const duration = Date.now() - startTime;
      await options.onJobComplete?.(jobName, jobId, duration, logs);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logs.push({ level: "error", message: errorMsg, timestamp: new Date() });
      await options.onJobFailed?.(jobName, jobId, errorMsg, logs);
      throw err;
    }
  }

  return {
    async start(): Promise<void> {
      worker = new Worker(queueName, handleJob, {
        connection: redisOpts,
        concurrency: 5,
      });

      // Register scheduled (cron) jobs
      for (const [name, jobDef] of allJobs) {
        if ("cron" in jobDef.trigger) {
          await queue.upsertJobScheduler(
            `scheduler-${name.replace(/\./g, "-")}`,
            { pattern: jobDef.trigger.cron },
            { name, data: {} },
          );
        }
      }

      // Run boot jobs
      for (const [name, jobDef] of allJobs) {
        if (jobDef.runOnBoot) {
          await queue.add(name, {}, { jobId: `boot-${name.replace(/\./g, "-")}` });
        }
      }
    },

    async stop(): Promise<void> {
      if (worker) {
        await worker.close();
        worker = null;
      }
      await queue.close();
    },

    async dispatch(
      jobName: string,
      payload?: Record<string, unknown>,
      meta?: JobMeta,
    ): Promise<string> {
      const jobDef = allJobs.get(jobName);
      if (!jobDef) {
        throw new Error(`Unknown job: ${jobName}`);
      }

      const concurrency = jobDef.concurrency ?? "parallel";
      const bullOpts: Record<string, unknown> = {};

      switch (concurrency) {
        case "skip": {
          const active = await queue.getActive();
          const waiting = await queue.getWaiting();
          const isRunning = [...active, ...waiting].some((j) => j.name === jobName);
          if (isRunning) {
            return "skipped";
          }
          break;
        }
        case "replace": {
          const waiting = await queue.getWaiting();
          for (const j of waiting) {
            if (j.name === jobName && j.id) {
              await j.remove();
            }
          }
          break;
        }
        case "sequential": {
          bullOpts["group"] = { id: jobName };
          break;
        }
        case "debounce": {
          const debounceMs = jobDef.debounceMs ?? 5000;
          bullOpts["debounce"] = { id: jobName, ttl: debounceMs };
          break;
        }
        default:
          break;
      }

      if (jobDef.retries !== undefined) bullOpts["attempts"] = jobDef.retries + 1;
      if (jobDef.backoff) bullOpts["backoff"] = { type: jobDef.backoff };
      if (jobDef.timeout) bullOpts["timeout"] = jobDef.timeout;

      // Pack meta into job data with _ prefix
      const data: Record<string, unknown> = { ...payload };
      if (meta?.triggeredById !== undefined) data["_triggeredById"] = meta.triggeredById;
      if (meta?.payload !== undefined) data["_payload"] = meta.payload;

      const job = await queue.add(jobName, data, bullOpts);
      return job.id ?? "unknown";
    },
  };
}
