import {
  buildSessionRoles,
  createSystemUser,
  defineWriteHandler,
  SYSTEM_ROLE,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { UserQueries } from "../../user/index.js";
import { parseAuthUserRow } from "../auth-user-row.js";
import { noMembership } from "../errors.js";
import { gateEnforceMfa, type LoginHandlerOptions } from "./login.write.js";

const SwitchTenantMfaGateSchema = z.object({
  userId: z.string().min(1),
  tenantId: z
    .string()
    .min(1)
    .transform((id) => id as TenantId),
});

export type SwitchTenantMfaGateData =
  | { readonly kind: "mfa-gate-clear" }
  | NonNullable<Awaited<ReturnType<typeof gateEnforceMfa>>>;

// Dispatched by POST /auth/switch-tenant with the system identity. The handler
// resolves membership and roles itself, so the gate never trusts caller-supplied
// roles; system-only access keeps it out of reach of /api/write callers.
export function createSwitchTenantMfaGateHandler(
  opts: Pick<LoginHandlerOptions, "mfaStatusChecker">,
) {
  return defineWriteHandler<
    "switch-tenant-mfa-gate",
    typeof SwitchTenantMfaGateSchema,
    SwitchTenantMfaGateData
  >({
    name: "switch-tenant-mfa-gate",
    schema: SwitchTenantMfaGateSchema,
    access: { roles: [SYSTEM_ROLE] },
    escapeHatch: {
      reason:
        "reads the MFA enrollment of the switch target tenant, not the caller's current tenant, via the mfaStatusChecker callback (it uses ctx.db.unsafeRaw())",
    },
    agent: { expose: false },
    description:
      "Runs the MFA gate of the login for a tenant switch and answers with an MFA challenge, a setup requirement, or clearance.",
    handler: async (event, ctx) => {
      const { userId, tenantId } = event.payload;
      const active = await ctx.resolveActiveMembership(userId, tenantId);
      if (active.kind === "rejected") return noMembership();
      const userRow = parseAuthUserRow(
        await ctx.queryAs(createSystemUser(tenantId), UserQueries.findForAuth, { id: userId }),
      );
      const roles = buildSessionRoles(parseRoles(userRow?.roles ?? null), active.membership.roles);
      const mfaGate = await gateEnforceMfa(ctx, opts, userId, tenantId, roles);
      return { isSuccess: true, data: mfaGate ?? { kind: "mfa-gate-clear" } };
    },
  });
}
