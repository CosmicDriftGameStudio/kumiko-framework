import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

const events: string[] = [];

export function typedMock(): HandlerContext {
  return {
    db: { tenantId: "t" },
    dbOutsideTransaction: undefined,
    registry: {},
    appendEvent: async (type: string) => {
      events.push(type);
    },
    loadAggregate: async () => ({}),
    query: async () => ({}),
    log: { info: () => {}, error: () => {} },
  } as unknown as HandlerContext;
}

export function castMock(): HandlerContext {
  const log = { info: () => {}, error: () => {} };
  return { db: { tenantId: "t" }, registry: {}, log, write: async () => ({ isSuccess: true }) } as HandlerContext;
}

export function annotatedMock(): HandlerContext {
  const mock: Partial<HandlerContext> = {
    async queryAs() {
      return {};
    },
    tracer: { span: () => {} },
  };
  return mock as HandlerContext;
}

export function spreadMock(base: HandlerContext): HandlerContext {
  return { ...base, appendEvent: async () => {} } as HandlerContext;
}

export function mixedNested(base: HandlerContext): HandlerContext {
  return {
    db: { tenantId: "t" },
    registry: {},
    write: async () => {
      base.log?.info("inner");
      return { isSuccess: true };
    },
  } as unknown as HandlerContext;
}
