import type { HandlerContext, Registry, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  type ChannelContext,
  collectChannels,
  createEmailAttachmentReader,
  EMAIL_CHANNEL_NAME,
} from "../../delivery/index.ts";
import { fileContextForTenant } from "../../file-foundation/index.ts";

export function emailChannelOf(registry: Registry) {
  return collectChannels(registry).find((channel) => channel.name === EMAIL_CHANNEL_NAME);
}

export function testMailChannelContext(ctx: HandlerContext, user: SessionUser): ChannelContext {
  return {
    db: ctx.db,
    registry: ctx.registry,
    sseBroker: undefined,
    tenantId: user.tenantId,
    secrets: ctx.secrets,
    config: ctx.config,
    readAttachment: createEmailAttachmentReader(
      ctx.db,
      ctx.registry,
      user.tenantId,
      ctx.config,
      (tenantId) => fileContextForTenant(ctx, ctx.user.tenantId, tenantId),
    ),
  };
}

export async function resolveTestMailAddress(
  channel: NonNullable<ReturnType<typeof emailChannelOf>>,
  channelContext: ChannelContext,
  user: SessionUser,
): Promise<string | null> {
  return (await channel.resolve?.(user.id, channelContext)) ?? null;
}
