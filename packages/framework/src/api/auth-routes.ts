import { Hono } from "hono";
import type { Dispatcher } from "../pipeline/dispatcher";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";
import type { JwtHelper } from "./jwt";

type MembershipRow = {
  userId: number;
  tenantId: number;
  roles: string[];
};

export type AuthRoutesConfig = {
  membershipQuery: string; // qualified query handler name, e.g. config.membershipQuery
};

export function createAuthRoutes(
  dispatcher: Dispatcher,
  jwt: JwtHelper,
  config: AuthRoutesConfig,
): Hono {
  const api = new Hono();

  // GET /auth/tenants — list tenants the current user belongs to
  api.get(Routes.authTenants, async (c) => {
    const user = getUser(c);

    try {
      const memberships = (await dispatcher.query(
        config.membershipQuery,
        { userId: user.id },
        user,
      )) as MembershipRow[];

      return c.json({
        tenants: memberships.map((m) => ({
          tenantId: m.tenantId,
          roles: m.roles,
        })),
        activeTenantId: user.tenantId,
      });
    } catch {
      // tenant.memberships handler not registered — return current tenant only
      return c.json({
        tenants: [{ tenantId: user.tenantId, roles: [...user.roles] }],
        activeTenantId: user.tenantId,
      });
    }
  });

  // POST /auth/switch-tenant — switch to a different tenant
  api.post(Routes.authSwitchTenant, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ tenantId: number }>();
    const targetTenantId = body.tenantId;

    if (targetTenantId === user.tenantId) {
      return c.json({ error: "already_in_tenant" }, 400);
    }

    try {
      // Check membership
      const memberships = (await dispatcher.query(
        config.membershipQuery,
        { userId: user.id },
        user,
      )) as MembershipRow[];

      const membership = memberships.find((m) => m.tenantId === targetTenantId);
      if (!membership) {
        return c.json({ error: "not_a_member" }, 403);
      }

      // Issue new JWT with the target tenant and its roles
      const newToken = await jwt.sign({
        id: user.id,
        tenantId: targetTenantId,
        roles: membership.roles,
      });

      return c.json({ token: newToken, tenantId: targetTenantId, roles: membership.roles });
    } catch {
      return c.json({ error: "tenant_switch_not_available" }, 400);
    }
  });

  return api;
}
