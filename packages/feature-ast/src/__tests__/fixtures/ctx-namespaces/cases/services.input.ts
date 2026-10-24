import type { HandlerContext, JobContext } from "@cosmicdrift/kumiko-types/handlers";

export async function handlerReads(ctx: HandlerContext) {
  const value = await ctx.redis?.get("key");
  const file = ctx.files?.ref("file");
  ctx.scheduleAfterCommit?.(async () => {});
  const configFor = ctx.configFor;
  const aborted = ctx.signal?.aborted;
  const meter = ctx.meter;
  return { value, file, aborted, configFor, meter };
}

export function jobReads(ctx: JobContext) {
  return [ctx.redis, ctx.signal, ctx.meter];
}

export async function destructured(ctx: HandlerContext) {
  const { redis, files: stored, db } = ctx;
  return [await redis?.get("key"), stored, db];
}

export function mockLiteral(): HandlerContext {
  return {
    db: { tenantId: "t" },
    registry: {},
    redis: { get: async () => null },
    scheduleAfterCommit: () => {},
  } as unknown as HandlerContext;
}

export function alreadyMigrated(ctx: HandlerContext) {
  return [ctx.services.redis, ctx.lifecycle.signal];
}

export function foreignReceiver(init: { readonly signal?: AbortSignal; readonly redis?: string }) {
  return [init.signal, init.redis];
}
