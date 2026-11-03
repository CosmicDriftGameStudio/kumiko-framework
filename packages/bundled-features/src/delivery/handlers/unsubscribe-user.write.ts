import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { setPreferenceEnabled } from "../set-preference-enabled.ts";

export const unsubscribeUserWrite = defineWriteHandler({
  name: "unsubscribeUser",
  schema: z.object({
    userId: z.string().min(1),
    notificationType: z.string().min(1),
    channel: z.string().min(1),
  }),
  access: { roles: access.systemAdmin },
  // Only reachable via createUnsubscribeRoutes' POST dispatchSystemWrite, once
  // verify() has already proven the user-token signature — not a surface for
  // the agent tool-picker to offer a user directly.
  agent: { expose: false },
  description:
    "Disables one notification type and channel combination for the userId carried in a verified unsubscribe token; dispatched by the signed unsubscribe route, not meant for UI callers.",
  handler: (event, ctx) => setPreferenceEnabled("unsubscribeUser", event, ctx, false),
});
