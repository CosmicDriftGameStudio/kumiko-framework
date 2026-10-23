import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

export async function closeTask(ctx: HandlerContext, id: string): Promise<void> {
  const aggregate = await ctx.loadAggregate(id);
  await ctx.appendEvent("task.closed", { id, aggregate });
  const lookup = await ctx.query("task:get", { id });
  await ctx?.write("task:audit", { lookup });
  ctx.log?.info("closed");
  ctx.metricsFor("tasks").count("closed");
  ctx.tracer.span("close");
  const outside = ctx.dbOutsideTransaction;
  if (outside === undefined) throw new Error("no outside db");
}

export class Closer {
  constructor(private readonly ctx: HandlerContext) {}

  run(): void {
    this.ctx.log?.info("run");
    void this.ctx.queryAs("a", {});
  }
}
