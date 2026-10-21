import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { AuthHandlers } from "../web/constants.ts";

// Anonymous-readable so the (unauthenticated) login screen can show the
// forgot-password and unlock links only when the matching mail flows are
// actually mounted, without every app having to pass hrefs by hand.
export const loginOptionsQuery = defineQueryHandler({
  name: "login-options",
  schema: z.object({}),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
  description:
    "Reports which optional login-page flows (password reset, account unlock) are available, readable without signing in, so the login screen links only to flows that exist.",
  handler: async (_query, ctx) => ({
    passwordReset: ctx.registry.getWriteHandler(AuthHandlers.requestPasswordReset) !== undefined,
    accountUnlock: ctx.registry.getWriteHandler(AuthHandlers.requestAccountUnlock) !== undefined,
  }),
});
