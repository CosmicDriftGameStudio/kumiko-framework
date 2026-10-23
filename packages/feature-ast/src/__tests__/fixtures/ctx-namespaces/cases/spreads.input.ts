import type { BridgeStub, HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

declare const base: HandlerContext;
declare function bridgeStub(): BridgeStub;
declare function otherStub(): { readonly extra: number };

export function noConflict(): HandlerContext {
  return {
    db: base.db,
    dbOutsideTransaction: undefined,
    registry: {},
    appendEvent: async () => {},
    ...otherStub(),
  } as unknown as HandlerContext;
}

export function afterSpread(): HandlerContext {
  return {
    ...base,
    appendEvent: async () => {},
    log: undefined,
  } as HandlerContext;
}

export function beforeSpread(): HandlerContext {
  return {
    write: async () => ({ isSuccess: true }),
    ...base,
  } as HandlerContext;
}

export function callSpread(): HandlerContext {
  return {
    ...bridgeStub(),
    write: async () => ({ isSuccess: true }),
  } as unknown as HandlerContext;
}

export function dbSpread(): HandlerContext {
  return {
    ...base,
    dbOutsideTransaction: undefined,
  } as HandlerContext;
}
