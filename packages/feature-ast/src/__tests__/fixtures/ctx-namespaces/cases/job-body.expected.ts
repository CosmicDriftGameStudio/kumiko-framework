import type { JobContext } from "@cosmicdrift/kumiko-types/handlers";

export async function nightly(ctx: JobContext): Promise<void> {
  await ctx.events.append("job.ran", {});
  await ctx.dispatch.write("task:sweep", {});
  ctx.obs.log.info("done");
  ctx.obs.metricsFor("jobs").count("ran");
  ctx.tracer?.span("nightly");
  void ctx.db;
  void ctx.dispatch.queryAsMember;
}
