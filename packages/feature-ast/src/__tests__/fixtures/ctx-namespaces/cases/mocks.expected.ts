import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

const events: string[] = [];

export function typedMock(): HandlerContext {
  return {
    db: { tenantId: "t", outsideTransaction: undefined },
    registry: {},
    events: { append: async (type: string) => {
      events.push(type);
    }, load: async () => ({}) },
    dispatch: { query: async () => ({}) },
    obs: { log: { info: () => {}, error: () => {} } },
  } as unknown as HandlerContext;
}

export function castMock(): HandlerContext {
  const log = { info: () => {}, error: () => {} };
  return { db: { tenantId: "t" }, registry: {}, obs: { log }, dispatch: { write: async () => ({ isSuccess: true }) } } as HandlerContext;
}

export function annotatedMock(): HandlerContext {
  const mock: Partial<HandlerContext> = {
    dispatch: { async queryAs() {
      return {};
    } },
    obs: { tracer: { span: () => {} } },
  };
  return mock as HandlerContext;
}

export function spreadMock(base: HandlerContext): HandlerContext {
  return { ...base, events: { ...base.events, append: async () => {} } } as HandlerContext;
}

export function mixedNested(base: HandlerContext): HandlerContext {
  return {
    db: { tenantId: "t" },
    registry: {},
    dispatch: { write: async () => {
      base.obs.log?.info("inner");
      return { isSuccess: true };
    } },
  } as unknown as HandlerContext;
}
