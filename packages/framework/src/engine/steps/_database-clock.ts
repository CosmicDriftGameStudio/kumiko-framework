import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { PipelineCtx } from "../types/step.ts";

// The resume scan compares wakeAt against Postgres now(); deriving it from the app clock would
// fire timers early or late by the host's clock skew.
export async function databaseNowIso(ctx: PipelineCtx): Promise<string> {
  const now = await ctx.db.databaseNow();
  return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toString();
}
