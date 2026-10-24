import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";
import type { SharedQueryContext } from "./structural-types-shared.ts";

type PatternQueryContext = {
  readonly dispatch: { readonly query: (qn: string, payload: unknown) => Promise<unknown> };
};

interface PatternWriter {
  readonly dispatch: { readonly write: (qn: string, payload: unknown) => Promise<unknown> };
  events: { append(type: string): Promise<void> };
  readonly label: string;
}

type Unrelated = { readonly query: (text: string) => string };

export async function direct(ctx: PatternQueryContext) {
  return ctx.dispatch.query("pattern:query:list", { limit: 1 });
}

export async function intersected(
  ctx: PatternQueryContext & { readonly db: HandlerContext["db"] },
) {
  return [ctx.db, await ctx.dispatch.query("pattern:query:list", {})];
}

export async function viaInterface(context: PatternWriter) {
  await context.dispatch.write("pattern:write:save", {});
  await context.events.append("saved");
  return context.label;
}

export const viaArrow = async (ctx: { readonly obs: { readonly log: (line: string) => void } }) => {
  ctx.obs.log("arrow");
};

export async function handsOn(ctx: PatternQueryContext) {
  return direct(ctx);
}

export async function foreignType(ctx: SharedQueryContext) {
  return ctx.query("pattern:query:list", {});
}

export async function notAContext(ctx: Unrelated) {
  return ctx.query("text");
}

export async function handler(ctx: HandlerContext) {
  await handsOn(ctx);
  await intersected(ctx);
  await viaInterface(ctx);
  await viaArrow(ctx);
  await foreignType(ctx);
}
