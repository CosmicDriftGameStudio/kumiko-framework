import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

export const hooks = {
  beforeTransaction: async (_event: object, ctx: HandlerContext): Promise<void> => {
    ctx.log?.info("prepare");
  },
};
