import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { setPreferenceEnabled } from "../set-preference-enabled.ts";

export const resubscribeUserWrite = defineWriteHandler({
  name: "resubscribeUser",
  schema: z.object({
    userId: z.string().min(1),
    notificationType: z.string().min(1),
    channel: z.string().min(1),
  }),
  access: { roles: access.systemAdmin },
  // Only reachable via createUnsubscribeRoutes' POST /resubscribe
  // dispatchSystemWrite, once verify() has already proven the user-token
  // signature — not a surface for the agent tool-picker to offer directly.
  agent: { expose: false },
  description:
    "Re-enables one notification type and channel combination for the userId carried in a verified unsubscribe token; dispatched by the signed resubscribe route, not meant for UI callers.",
  handler: (event, ctx) => setPreferenceEnabled("resubscribeUser", event, ctx, true),
});
