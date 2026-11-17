import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { upsertAddressOptOut } from "../address-opt-out.ts";
import { currentNotificationType } from "../notification-type-aliases.ts";
import { DELIVERY_ADDRESS_UNSUBSCRIBED_EVENT } from "../web/public-names.ts";

// Also the payload of DELIVERY_ADDRESS_UNSUBSCRIBED_EVENT, which an app job triggers on
// after a committed address opt-out (the tenant is the job's `ctx.triggeredBy.tenantId`).
export const unsubscribeAddressPayloadSchema = z.object({
  addressHash: z.string().min(1),
  notificationType: z.string().min(1),
  channel: z.string().min(1),
});
export type UnsubscribeAddressPayload = z.infer<typeof unsubscribeAddressPayloadSchema>;

export const unsubscribeAddressWrite = defineWriteHandler({
  name: "unsubscribeAddress",
  schema: unsubscribeAddressPayloadSchema,
  access: { roles: access.systemAdmin },
  // Only reachable via createUnsubscribeRoutes' POST dispatchSystemWrite, once
  // verify() has already proven the address-token signature — not a surface
  // for the agent tool-picker to offer a user directly.
  agent: { expose: false },
  description:
    "Records a no-account address opt-out for one notificationType/channel combination; dispatched by the signed unsubscribe route, not meant for UI callers.",
  systemScope: true,
  handler: async (event, ctx) => {
    const { addressHash, channel } = event.payload;
    const notificationType = currentNotificationType(ctx.registry, event.payload.notificationType);
    const { tenantId } = event.user;

    const db = ctx.systemDb.scopedTo(tenantId);

    const result = await upsertAddressOptOut(db, event.user, {
      tenantId,
      addressHash,
      notificationType,
      channel,
    });
    if (!result.isSuccess) return result;
    await ctx.events.unsafeAppend({
      aggregateId: crypto.randomUUID(),
      aggregateType: "delivery-address-unsubscribe",
      type: DELIVERY_ADDRESS_UNSUBSCRIBED_EVENT,
      payload: { addressHash, notificationType, channel },
      expectedVersion: 0,
    });
    return { isSuccess: true, data: { notificationType, channel } };
  },
});
