import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";

export const SYSTEM_ADMIN_ROLE = "SystemAdmin";

// "system" targets the platform-wide secrets under SYSTEM_TENANT_ID (settings a SystemAdmin
// edits for the whole app). The target is never taken from the payload, only chosen here.
export const secretScopeSchema = z.enum(["tenant", "system"]).optional();

export type SecretScope = z.infer<typeof secretScopeSchema>;

export type SecretTarget =
  | { readonly ok: true; readonly tenantId: TenantId }
  | { readonly ok: false; readonly error: AccessDeniedError };

export function resolveSecretTarget(
  user: Pick<SessionUser, "tenantId" | "roles">,
  scope: SecretScope,
): SecretTarget {
  if (scope !== "system") return { ok: true, tenantId: user.tenantId };
  if (!user.roles.includes(SYSTEM_ADMIN_ROLE)) {
    return {
      ok: false,
      error: new AccessDeniedError({ message: "system-scope secrets need the SystemAdmin role" }),
    };
  }
  return { ok: true, tenantId: SYSTEM_TENANT_ID };
}
