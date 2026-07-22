import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { AUTH_SELF_REGISTRATION_FEATURE } from "../self-registration-toggle";

// Anonymous-readable status for the (unauthenticated) signup page: lets it
// hide its own link/form when an operator has flipped self-registration
// off, instead of collecting an email that signup-request will silently
// no-op on. Lives in auth-email-password itself (never toggleable) rather
// than on the auth-self-registration companion feature — the dispatcher's
// per-feature gate would otherwise make this query unreachable exactly when
// the toggle is off (same split as managed-pages' branding query vs.
// css-gate.ts).
export const selfRegistrationStatusQuery = defineQueryHandler({
  name: "signup-registration-status",
  schema: z.object({}),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (_query, ctx) => ({
    enabled: await ctx.hasFeature(AUTH_SELF_REGISTRATION_FEATURE),
  }),
});
