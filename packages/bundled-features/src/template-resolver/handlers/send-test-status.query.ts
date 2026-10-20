import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  emailChannelOf,
  resolveTestMailAddress,
  testMailChannelContext,
} from "./send-test-shared.ts";

export type SendTestStatus =
  | { readonly canSend: true; readonly reason: null }
  | { readonly canSend: false; readonly reason: "no_channel" | "no_address" };

export const sendTestStatusQuery = defineQueryHandler({
  name: "send-test-status",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Tells whether send-test can reach the calling user: canSend is true when an email channel is mounted and resolves an address for the caller, otherwise reason is no_channel or no_address; the address itself is never returned.",
  handler: async (query, ctx): Promise<SendTestStatus> => {
    const channel = emailChannelOf(ctx.registry);
    if (channel === undefined) return { canSend: false, reason: "no_channel" };
    const address = await resolveTestMailAddress(
      channel,
      testMailChannelContext(ctx, query.user),
      query.user,
    );
    return address === null
      ? { canSend: false, reason: "no_address" }
      : { canSend: true, reason: null };
  },
});
