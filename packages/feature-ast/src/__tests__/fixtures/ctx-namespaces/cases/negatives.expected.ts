import type { AppContext } from "@cosmicdrift/kumiko-types/handlers";
import type { ExtraRouteContext, MspApplyContext, StepContext } from "../others.ts";

export async function apply(context: MspApplyContext): Promise<void> {
  await context.appendEvent("x", {});
  await context.loadAggregate("y");
}

export async function step(ctx: StepContext): Promise<void> {
  await ctx.appendEvent("z");
}

export function hook(context: AppContext): void {
  context.log?.info("hook");
  void context.queryAsMember;
}

export function route(socket: ExtraRouteContext): void {
  socket.write("frame");
  socket.log.info("route");
}

export function arbitrary(logger: { log: (line: string) => void }): void {
  logger.log("line");
}
