import type { Context } from "hono";
import { createSystemUser } from "../engine/system-user.ts";
import type {
  ActiveMembershipRejection,
  ActiveMembershipResult,
  SessionUser,
  TenantId,
} from "../engine/types/index.ts";
import { assertUnreachable } from "../utils/index.ts";
import { Routes } from "./api-constants.ts";
import { getUser } from "./auth-middleware.ts";
import type { AuthRouteContext } from "./auth-routes-context.ts";
import { isUnknownHandlerError } from "./auth-routes-shared.ts";
import { clearSessionCookies, getSessionCookies } from "./session-cookies.ts";

function switchTenantRejectionResponse(c: Context, reason: ActiveMembershipRejection): Response {
  switch (reason) {
    case "not_a_member":
      return c.json({ error: "not_a_member" }, 403);
    case "principal_blocked":
      return c.json({ error: "principal_blocked" }, 403);
    case "tenant_teardown":
      return c.json({ error: "tenant_unavailable" }, 410);
    default:
      return assertUnreachable(reason, "ActiveMembershipRejection");
  }
}

type MembershipRow = {
  userId: string;
  tenantId: TenantId;
  roles: string[];
  /** Display name of the tenant — the membershipQuery returns it since the
   *  tenant-switcher fix; optional for older app-owned queries. */
  tenantName?: string;
  tenantKey?: string;
};

// A missing, malformed or non-object body reads as {} so callers answer with their own 400.
async function readJsonObjectOrEmpty(req: {
  json(): Promise<unknown>;
}): Promise<{ tenantId?: unknown }> {
  const raw: unknown = await req.json().catch(() => null);
  return raw !== null && typeof raw === "object" ? raw : {};
}

function tenantIndependentPrefs(user: SessionUser): Pick<SessionUser, "timezone" | "locale"> {
  return {
    ...(user.timezone ? { timezone: user.timezone } : {}),
    ...(user.locale ? { locale: user.locale } : {}),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function registerSessionRoutes(ctx: AuthRouteContext): void {
  const {
    api,
    dispatcher,
    config,
    sessionCookies,
    switchTenantMfaGate,
    resolveSwitchTenantRoles,
    mintSessionAndRespond,
  } = ctx;
  // POST /auth/logout — revokes the current session. Requires a valid JWT so
  // the middleware has already populated `user.sid` from the `jti` claim. If
  // the app hasn't wired a sessionRevoker, logout is effectively a no-op on
  // the server — the client can just drop the token.
  api.post(Routes.authLogout, async (c) => {
    const user = getUser(c);
    if (config.sessionRevoker && user.sid) {
      await config.sessionRevoker(user.sid);
    }
    // Clear cookies on the cookie-transport path. Idempotent — clearing a
    // missing cookie is a no-op, so bearer-only clients aren't affected.
    clearSessionCookies(c, getSessionCookies(c, sessionCookies));
    return c.json({ isSuccess: true });
  });

  // GET /auth/tenants — list tenants the current user belongs to
  api.get(Routes.authTenants, async (c) => {
    const user = getUser(c);

    try {
      // System-scoped: membershipQuery is access-locked to system-role.
      // @cast-boundary engine-payload — generic dispatcher.query result
      const memberships = (await dispatcher.query(
        config.membershipQuery,
        { userId: user.id },
        createSystemUser(user.tenantId),
      )) as MembershipRow[];

      return c.json({
        tenants: memberships.map((m) => ({
          tenantId: m.tenantId,
          roles: m.roles,
          ...(m.tenantName !== undefined && { name: m.tenantName }),
          ...(m.tenantKey !== undefined && { key: m.tenantKey }),
        })),
        activeTenantId: user.tenantId,
      });
    } catch (e) {
      // Only legitimate fallback: the app hasn't wired membershipQuery at
      // all. A DB fault or a permission failure has to bubble up so ops
      // sees it — collapsing them into "just your current tenant" hides
      // outages behind a UI that looks fine.
      if (!isUnknownHandlerError(e)) throw e;
      return c.json({
        tenants: [{ tenantId: user.tenantId, roles: [...user.roles] }],
        activeTenantId: user.tenantId,
      });
    }
  });

  // POST /auth/switch-tenant — switch to a different tenant
  api.post(Routes.authSwitchTenant, async (c) => {
    const user = getUser(c);
    const body = await readJsonObjectOrEmpty(c.req);
    // The id seeds a SYSTEM identity in resolveActiveMembership — reject anything
    // that is not a non-empty string before it gets that far.
    if (!isNonEmptyString(body.tenantId)) {
      return c.json({ error: "invalid_tenant" }, 400);
    }
    const targetTenantId = body.tenantId as TenantId; // @cast-boundary request-body

    if (targetTenantId === user.tenantId) {
      return c.json({ error: "already_in_tenant" }, 400);
    }

    // Membership + principal-blocked + tenant-teardown in one building
    // block — trusted server code asking on the user's behalf, same trust boundary as before.
    let activeMembership: ActiveMembershipResult;
    try {
      activeMembership = await dispatcher.resolveActiveMembership(user.id, targetTenantId);
    } catch (e) {
      // No membershipQuery wired → switching tenants is just not offered in
      // this deployment. Any other error propagates so a broken query handler
      // surfaces as a real 5xx instead of a misleading 400.
      if (!isUnknownHandlerError(e)) throw e;
      return c.json({ error: "tenant_switch_not_available" }, 400);
    }

    if (activeMembership.kind === "rejected") {
      return switchTenantRejectionResponse(c, activeMembership.reason);
    }
    const membership = activeMembership.membership;

    const gate = await switchTenantMfaGate(c, user, targetTenantId);
    if (gate !== undefined && "response" in gate) return gate.response;
    const sessionRoles =
      gate !== undefined ? gate.clearedRoles : await resolveSwitchTenantRoles(user, membership);
    // Issue new JWT with the target tenant and its roles. Claims MUST be
    // recomputed for the new tenant — stale claims from the previous
    // tenant would leak identity facts across tenancies (e.g. teamId from
    // tenant A accidentally surviving into tenant B's session). The
    // resolver runs each feature's r.authClaims() hook under the new
    // TenantDb scope.
    const targetSession: SessionUser = {
      id: user.id,
      tenantId: targetTenantId,
      roles: sessionRoles,
      // Tenant-independent prefs must survive the switch.
      ...tenantIndependentPrefs(user),
    };
    const claims = await dispatcher.resolveAuthClaims(targetSession);
    const sessionForJwt: SessionUser =
      Object.keys(claims).length > 0 ? { ...targetSession, claims } : targetSession;

    // Session rotation: revoke old sid BEFORE creating the new one so a
    // creator failure leaves the user logged-out cleanly rather than with
    // two live sessions. Client must log in again on creator-throw. A
    // revoker/creator that actually throws (Redis down, DB deadlock) surfaces
    // as a 5xx — swallowing it into tenant_switch_not_available was hiding
    // real outages.
    if (config.sessionRevoker && user.sid) {
      await config.sessionRevoker(user.sid);
    }
    // Session creation + JWT sign + cookies — see mintSessionAndRespond. A
    // fresh csrfToken is minted (inside the helper) so a compromised csrf-
    // value can't cross a tenant boundary.
    const newToken = await mintSessionAndRespond(c, sessionForJwt);

    return c.json({ token: newToken, tenantId: targetTenantId, roles: sessionRoles });
  });
}
