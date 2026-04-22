import type { TenantId } from "@kumiko/framework/engine";
import type { DeliveryChannel } from "../delivery";
import type { PushTransport } from "./types";

export type PushChannelOptions = {
  readonly transport: PushTransport;
  readonly resolveToken: (
    userId: string,
    ctx: { db: unknown; tenantId: TenantId },
  ) => Promise<string | null>;
};

export function createPushChannel(options: PushChannelOptions): DeliveryChannel {
  const { transport, resolveToken } = options;

  return {
    name: "push",

    async resolve(userId, ctx) {
      return resolveToken(userId, ctx);
    },

    async send(address, message, _ctx) {
      await transport.send({
        token: address,
        title: message.title,
        body: message.body,
        data: message.data,
      });
      return { status: "sent", address };
    },
  };
}
