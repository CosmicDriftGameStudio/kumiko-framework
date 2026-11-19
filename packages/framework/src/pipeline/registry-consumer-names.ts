import type { JobDefinition } from "@cosmicdrift/kumiko-types/config";
import type { Registry } from "../engine/types/index.ts";
import { CATCH_UP_JOB_CONSUMER_PREFIX, catchUpJobConsumerName } from "./catch-up-job-consumer.ts";

type EventJobTrigger = Extract<JobDefinition["trigger"], { readonly on: unknown }>;

export type CatchUpJob = {
  readonly name: string;
  readonly definition: JobDefinition;
  readonly trigger: EventJobTrigger;
};

export function catchUpJobsOf(registry: Registry): readonly CatchUpJob[] {
  const catchUpJobs: CatchUpJob[] = [];
  for (const [name, definition] of registry.getAllJobs()) {
    const { trigger } = definition;
    if (!("on" in trigger) || !trigger.catchUp) continue;
    catchUpJobs.push({ name, definition, trigger });
  }
  return catchUpJobs;
}

// Every lane's consumers, not one process's: a worker running a subset must not call the rest stale.
export function registryDeclaredConsumerNames(registry: Registry): ReadonlySet<string> {
  return new Set([
    ...registry.getAllMultiStreamProjections().keys(),
    ...catchUpJobsOf(registry).map((job) => catchUpJobConsumerName(job.name)),
  ]);
}

// Only these shapes come from the registry; a name of any other shape (system consumers included)
// has a source registryDeclaredConsumerNames cannot see, so it must never be treated as stale.
export function isRegistryShapedConsumerName(name: string): boolean {
  return name.startsWith(CATCH_UP_JOB_CONSUMER_PREFIX) || name.split(":")[1] === "projection";
}
