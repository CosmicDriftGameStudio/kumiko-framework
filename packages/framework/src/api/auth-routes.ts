import { Hono } from "hono";
import type { SessionUser } from "../engine/types";
import type { Dispatcher } from "../pipeline/dispatcher";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";
import type { JwtHelper } from "./jwt";

type MembershipRow = {
  userId: number;
  tenantId: number;
  roles: string[];
};

// Guest identity used for unauthenticated calls (e.g. login). The "all" role
// lets framework access checks pass for handlers declared with roles: ["all"].
const GUEST_USER: SessionUser = { id: 0, tenantId: 0, roles: ["all"] };

export type AuthRoutesConfig = {
  membershipQuery: string; // qualified query handler name, e.g. config.membershipQuery
  // Optional: qualified write handler for login. When set, POST /auth/login
  // dispatches to this handler with a guest identity and issues a JWT on
  // success. Handler must return { kind: "auth-session", session: SessionUser }.
  loginHandler?: string;
  // Maps feature-specific login error codes to HTTP status codes. Unknown
  // errors default to 400. Keeps the framework unaware of concrete auth codes.
  loginErrorStatusMap?: Readonly<Record<string, number>>;
};

export function createAuthRoutes(
  dispatcher: Dispatcher,
  jwt: JwtHelper,
  config: AuthRoutesConfig,
): Hono {
  const api = new Hono();

  // POST /auth/login — public endpoint (bypasses auth middleware via PUBLIC_API_PATHS).
  // The configured login handler authenticates and returns a SessionUser;
  // the route signs the JWT and hands it back to the client.
  if (config.loginHandler) {
    const loginQn = config.loginHandler;
    const statusMap = config.loginErrorStatusMap ?? {};
    api.post(Routes.authLogin, async (c) => {
      const body = await c.req.json<{ email: string; password: string }>();
      const result = await dispatcher.write(loginQn, body, GUEST_USER);

      if (!result.isSuccess) {
        // Error format: "error_code" or "error_code: detail" — extract code.
        const colonIdx = result.error.indexOf(":");
        const code = colonIdx > 0 ? result.error.slice(0, colonIdx) : result.error;
        const status = (statusMap[code] ?? 400) as 400 | 401 | 403 | 500;
        return c.json({ isSuccess: false, error: result.error }, status);
      }

      const data = result.data as { kind: "auth-session"; session: SessionUser };
      const token = await jwt.sign(data.session);
      return c.json({
        isSuccess: true,
        token,
        user: { id: data.session.id, tenantId: data.session.tenantId, roles: data.session.roles },
      });
    });
  }

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
