import { defineQueryHandler, type JobDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export type ManualJobCatalogEntry = {
  readonly jobName: string;
  readonly perTenant: boolean;
  /** Compact JSON Schema (or null when the job accepts any/empty payload). */
  readonly payloadSchema: Record<string, unknown> | null;
};

function isManualTrigger(trigger: JobDefinition["trigger"]): boolean {
  return "manual" in trigger && trigger.manual === true;
}

function payloadSchemaJson(job: JobDefinition): Record<string, unknown> | null {
  if (job.schema === undefined) return null;
  try {
    return z.toJSONSchema(job.schema) as Record<string, unknown>;
  } catch {
    // Non-JSON-Schema-able Zod types (transforms/effects) — UI still lists the job.
    return null;
  }
}

/** SystemAdmin catalog of jobs that may be started via `jobs:write:trigger`. */
export const catalogQuery = defineQueryHandler({
  name: "catalog",
  schema: z.object({}),
  access: { roles: ["SystemAdmin"] },
  handler: async (_query, ctx): Promise<{ rows: readonly ManualJobCatalogEntry[] }> => {
    const rows: ManualJobCatalogEntry[] = [];
    for (const [jobName, job] of ctx.registry.getAllJobs()) {
      if (!isManualTrigger(job.trigger)) continue;
      rows.push({
        jobName,
        perTenant: job.perTenant === true,
        payloadSchema: payloadSchemaJson(job),
      });
    }
    rows.sort((a, b) => a.jobName.localeCompare(b.jobName));
    return { rows };
  },
});
