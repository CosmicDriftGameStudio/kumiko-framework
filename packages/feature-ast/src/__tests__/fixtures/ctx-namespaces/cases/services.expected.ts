import type { HandlerContext, JobContext } from "@cosmicdrift/kumiko-types/handlers";

export async function handlerReads(ctx: HandlerContext) {
  const value = await ctx.services.redis?.get("key");
  const file = ctx.services.files?.ref("file");
  ctx.lifecycle.afterCommit?.(async () => {});
  const configFor = ctx.tenants.config;
  const aborted = ctx.lifecycle.signal?.aborted;
  const meter = ctx.obs.meter;
  return { value, file, aborted, configFor, meter };
}

export function jobReads(ctx: JobContext) {
  return [ctx.services.redis, ctx.lifecycle.signal, ctx.obs.meter];
}

export async function destructured(ctx: HandlerContext) {
  const { services: { redis, files: stored }, db } = ctx;
  return [await redis?.get("key"), stored, db];
}

export function mockLiteral(): HandlerContext {
  return {
    db: { tenantId: "t" },
    registry: {},
    services: { redis: { get: async () => null }, extensions: {} },
    lifecycle: { afterCommit: () => {} },
  } as unknown as HandlerContext;
}

export function alreadyMigrated(ctx: HandlerContext) {
  return [ctx.services.redis, ctx.lifecycle.signal];
}

export function foreignReceiver(init: { readonly signal?: AbortSignal; readonly redis?: string }) {
  return [init.signal, init.redis];
}
