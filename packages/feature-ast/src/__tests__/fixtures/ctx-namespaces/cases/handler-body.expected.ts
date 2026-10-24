import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

export async function closeTask(ctx: HandlerContext, id: string): Promise<void> {
  const aggregate = await ctx.events.load(id);
  await ctx.events.append("task.closed", { id, aggregate });
  const lookup = await ctx.dispatch.query("task:get", { id });
  await ctx?.dispatch.write("task:audit", { lookup });
  ctx.obs.log?.info("closed");
  ctx.obs.metricsFor("tasks").count("closed");
  ctx.obs.tracer.span("close");
  const outside = ctx.db.outsideTransaction;
  if (outside === undefined) throw new Error("no outside db");
}

export class Closer {
  constructor(private readonly ctx: HandlerContext) {}

  run(): void {
    this.ctx.obs.log?.info("run");
    void this.ctx.dispatch.queryAs("a", {});
  }
}
