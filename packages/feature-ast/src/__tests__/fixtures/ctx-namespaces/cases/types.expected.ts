import type { HandlerContext, JobContext } from "@cosmicdrift/kumiko-types/handlers";

export type AppendEvent = HandlerContext["events"]["append"];
export type Logging = NonNullable<HandlerContext["obs"]["log"]>;
export type Untouched = HandlerContext["db"];
export type HandlerSlice = Pick<HandlerContext, "events" | "obs" | "db" | "dispatch">;
export type JobSlice = Pick<JobContext, "events" | "dispatch">;
export type WithoutQuery = Omit<HandlerContext, "query">;
export type WithoutDb = Omit<HandlerContext, "db">;

export function slim(ctx: Pick<HandlerContext, "events">): Promise<void> {
  return ctx.events.append("slim", {});
}
