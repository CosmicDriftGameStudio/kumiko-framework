import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { upsertAddressOptOut } from "../address-opt-out.ts";
import { currentNotificationType } from "../notification-type-aliases.ts";

// Also the payload an app job receives with `trigger: { on: DeliveryHandlers.unsubscribeAddress }`
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
  handler: async (event, ctx) => {
    const { addressHash, channel } = event.payload;
    const notificationType = currentNotificationType(ctx.registry, event.payload.notificationType);
    const { tenantId } = event.user;

    if (!ctx.systemDb) {
      throw new InternalError({
        message: "unsubscribeAddress: ctx.systemDb missing on a system-scoped handler",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(tenantId);

    const result = await upsertAddressOptOut(db, event.user, {
      tenantId,
      addressHash,
      notificationType,
      channel,
    });
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: { notificationType, channel } };
  },
});
