import {
  createSystemUser,
  type JobContext,
  type ProbeContext,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { decryptStoredUserEmail } from "../shared/index.ts";
import { UserQueries } from "../user/index.ts";

const triggeringUserRowSchema = z.object({
  email: z.string().optional(),
  isDeleted: z.boolean().nullish(),
});

async function resolveTriggeredByEmail(
  ctx: JobContext,
  tenantId: TenantId,
  userId: string,
): Promise<string | undefined> {
  if (!ctx.registry.features.has("user")) return undefined;
  let found: unknown;
  try {
    found = await ctx.dispatch.queryAs(createSystemUser(tenantId), UserQueries.findForAuth, {
      id: userId,
    });
  } catch (error) {
    // Probes that need the address skip themselves; the lookup must not take the whole run down.
    ctx.obs.log.warn("readiness could not look up the run starter", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return undefined;
  }
  const row = triggeringUserRowSchema.safeParse(found);
  if (!row.success || row.data.email === undefined || row.data.isDeleted === true) {
    return undefined;
  }
  return (await decryptStoredUserEmail(row.data.email, "readiness:run-probes")) ?? undefined;
}

export async function buildProbeContext(
  ctx: JobContext,
  run: { readonly id: string; readonly triggeredByUserId: string },
  tenantId: TenantId,
): Promise<ProbeContext> {
  return {
    db: ctx.db,
    registry: ctx.registry,
    obs: ctx.obs,
    tz: ctx.tz,
    services: ctx.services,
    probeRunId: run.id,
    tenantId,
    triggeredByUserId: run.triggeredByUserId,
    triggeredByEmail: await resolveTriggeredByEmail(ctx, tenantId, run.triggeredByUserId),
  };
}
