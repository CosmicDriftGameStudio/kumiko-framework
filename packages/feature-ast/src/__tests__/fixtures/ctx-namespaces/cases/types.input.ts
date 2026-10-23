import type { HandlerContext, JobContext } from "@cosmicdrift/kumiko-types/handlers";

export type AppendEvent = HandlerContext["appendEvent"];
export type Logging = NonNullable<HandlerContext["log"]>;
export type Untouched = HandlerContext["db"];
export type HandlerSlice = Pick<HandlerContext, "appendEvent" | "log" | "db" | "write">;
export type JobSlice = Pick<JobContext, "appendEvent" | "write">;
export type WithoutQuery = Omit<HandlerContext, "query">;
export type WithoutDb = Omit<HandlerContext, "db">;

export function slim(ctx: Pick<HandlerContext, "appendEvent">): Promise<void> {
  return ctx.appendEvent("slim", {});
}
