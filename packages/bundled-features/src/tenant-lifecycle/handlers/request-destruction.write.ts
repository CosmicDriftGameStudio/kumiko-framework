import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { TENANT_ACCOUNT_CLOSE_ROLES } from "../constants.ts";
import { requestTenantDestruction } from "../request-tenant-destruction.ts";

const REQUEST_DESTRUCTION_TENANT_ROW_REASON =
  "reads the caller's tenant row (a global row on the system tenant), its compliance profile, appends to the tenant stream on the system tenant and revokes its sessions via DbRunner helpers";

export const requestDestructionWrite = defineWriteHandler({
  name: "request-destruction",
  schema: z.object({}),
  access: { roles: TENANT_ACCOUNT_CLOSE_ROLES },
  description:
    "Puts the caller's own tenant into destroyRequested, starts the compliance-profile grace period after which its data is erased, and revokes every session in the tenant; use it when an account owner asks to close their account.",
  agent: { risk: "high" },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: REQUEST_DESTRUCTION_TENANT_ROW_REASON,
  },
  handler: async (event, ctx) =>
    requestTenantDestruction({
      tenantId: event.user.tenantId,
      actor: event.user,
      now: ctx.tz.now(),
      db: ctx.db,
      runner: ctx.db.unsafeRaw(),
      registry: ctx.registry,
      revokeSessions: await ctx.hasFeature("sessions"),
    }),
});
