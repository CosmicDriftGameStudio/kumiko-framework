import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

type Hooks = {
  reserveBeforeTransaction?: (event: object, ctx: HandlerContext) => Promise<void>;
  beforeTransaction?: (event: object, ctx: HandlerContext) => Promise<void>;
};

export const hooks: Hooks = {
  reserveBeforeTransaction: async (_event: object, ctx: HandlerContext): Promise<void> => {
    await ctx.query("cap:reserve", {});
  },
  beforeTransaction: async (_event, ctx: HandlerContext): Promise<void> => {
    ctx.log?.info("prepare");
  },
};
