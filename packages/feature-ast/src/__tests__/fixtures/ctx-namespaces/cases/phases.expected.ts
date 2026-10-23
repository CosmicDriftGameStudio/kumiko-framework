import type { HandlerContext, ReservationContext, BeforeTransactionContext } from "@cosmicdrift/kumiko-types/handlers";

type Hooks = {
  reserveBeforeTransaction?: (event: object, ctx: HandlerContext) => Promise<void>;
  beforeTransaction?: (event: object, ctx: HandlerContext) => Promise<void>;
};

export const hooks: Hooks = {
  reserveBeforeTransaction: async (_event: object, ctx: ReservationContext): Promise<void> => {
    await ctx.dispatch.query("cap:reserve", {});
  },
  beforeTransaction: async (_event, ctx: BeforeTransactionContext): Promise<void> => {
    ctx.obs.log?.info("prepare");
  },
};
