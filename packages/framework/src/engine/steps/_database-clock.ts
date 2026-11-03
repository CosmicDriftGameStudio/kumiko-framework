import { legacyDateToInstant } from "../../time/legacy-date.ts";
import type { PipelineCtx } from "../types/step.ts";

// The resume scan compares wakeAt against Postgres now(); deriving it from the app clock would
// fire timers early or late by the host's clock skew.
export async function databaseNowIso(ctx: PipelineCtx): Promise<string> {
  return legacyDateToInstant(await ctx.db.databaseNow()).toString();
}
