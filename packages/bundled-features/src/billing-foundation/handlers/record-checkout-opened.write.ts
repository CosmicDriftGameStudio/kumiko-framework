// record-checkout-opened — ledgers a checkout that was opened before the
// ledger existed (provider migration jobs). Idempotent: an existing entry is
// left alone.

import { defineWriteHandler, type WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { appendCheckoutOpened, findCheckoutOpened, ledgerAggregateId } from "../checkout-ledger.ts";
import { checkoutOpenedPayloadSchema } from "../events.ts";

export const recordCheckoutOpenedHandler = defineWriteHandler({
  name: "record-checkout-opened",
  agent: { expose: false },
  schema: checkoutOpenedPayloadSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx): Promise<WriteResult<{ readonly recorded: boolean }>> => {
    const entry = event.payload;
    const tenantId = event.user.tenantId;
    const existing = await ctx.events.load(ledgerAggregateId(tenantId, entry.mode));
    if (findCheckoutOpened(existing, entry) !== undefined) {
      return { isSuccess: true as const, data: { recorded: false as const } };
    }
    await appendCheckoutOpened(ctx, tenantId, entry);
    return { isSuccess: true as const, data: { recorded: true as const } };
  },
});
