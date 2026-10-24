import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";
import type { SharedQueryContext } from "./structural-types-shared.ts";

type PatternQueryContext = {
  readonly query: (qn: string, payload: unknown) => Promise<unknown>;
};

interface PatternWriter {
  readonly write: (qn: string, payload: unknown) => Promise<unknown>;
  appendEvent(type: string): Promise<void>;
  readonly label: string;
}

type Unrelated = { readonly query: (text: string) => string };

export async function direct(ctx: PatternQueryContext) {
  return ctx.query("pattern:query:list", { limit: 1 });
}

export async function intersected(
  ctx: PatternQueryContext & { readonly db: HandlerContext["db"] },
) {
  return [ctx.db, await ctx.query("pattern:query:list", {})];
}

export async function viaInterface(context: PatternWriter) {
  await context.write("pattern:write:save", {});
  await context.appendEvent("saved");
  return context.label;
}

export const viaArrow = async (ctx: { readonly log: (line: string) => void }) => {
  ctx.log("arrow");
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
