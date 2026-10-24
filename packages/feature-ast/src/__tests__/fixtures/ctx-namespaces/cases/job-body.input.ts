import type { JobContext } from "@cosmicdrift/kumiko-types/handlers";

export async function nightly(ctx: JobContext): Promise<void> {
  await ctx.appendEvent("job.ran", {});
  await ctx.write("task:sweep", {});
  ctx.log.info("done");
  ctx.metricsFor("jobs").count("ran");
  ctx.tracer?.span("nightly");
  void ctx.db;
  void ctx.queryAsMember;
}
