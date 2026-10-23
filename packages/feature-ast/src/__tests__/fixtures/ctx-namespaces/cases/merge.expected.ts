import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

export const merged = {
  db: { tenantId: "t", outsideTransaction: undefined },
  registry: {},
  events: { load: async () => ({}), append: async () => {} },
  dispatch: { ...queryOnly(), write: async () => ({ isSuccess: true }) },
} as unknown as HandlerContext;

function queryOnly(): never {
  throw new Error("unused");
}
