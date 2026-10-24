import type { BeforeTransactionContext } from "@cosmicdrift/kumiko-types/handlers";

export const hooks = {
  beforeTransaction: async (_event: object, ctx: BeforeTransactionContext): Promise<void> => {
    ctx.obs.log?.info("prepare");
  },
};
