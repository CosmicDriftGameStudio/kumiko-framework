import { Hono } from "hono";
import { createSystemUser } from "../engine/system-user";
import { type SessionUser, SYSTEM_TENANT_ID, type TenantId } from "../engine/types";
import type { Dispatcher } from "../pipeline/dispatcher";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";
import type { JwtHelper } from "./jwt";

type MembershipRow = {
  userId: string;
  tenantId: TenantId;
  roles: string[];
};

// Guest identity used for unauthenticated calls (e.g. login). The "all" role
// lets framework access checks pass for handlers declared with roles: ["all"].
// `id` is the zero-uuid so it flows through event-store columns cleanly.
const GUEST_USER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  tenantId: SYSTEM_TENANT_ID,
  roles: ["all"],
};

// Pluggable rate-limiter for POST /auth/login. Returning `false` blocks the
// request with 429 before the login handler runs — use this to slow down
// brute-force attempts. The framework ships a default in-memory impl; apps
// can swap it for a Redis-backed one for multi-node deployments.
export type LoginRateLimiter = {
  check(key: string): Promise<boolean>;
  // Called on successful login so a legitimate user's counter gets reset.
  reset(key: string): Promise<void>;
};

// Per-session metadata forwarded to the sessionCreator. Captured at login
// time so the sessions feature can store IP/UA alongside each record for
// session-list UIs ("your devices") and security-audit flows.
export type SessionMetadata = {
  readonly ip: string;
  readonly userAgent: string;
};

// Invoked on a successful login (and on switch-tenant) so an app can persist
// a session record and return its ID. The returned string is embedded in the
// JWT's `jti` claim and echoed back as `SessionUser.sid` on every request.
// When the callback is not wired, JWTs are stateless — they remain valid
// until expiration, with no server-side revocation. The framework stays
// agnostic about WHERE sessions live (DB, Redis, memory); that's the
// sessions feature's job.
export type SessionCreator = (user: SessionUser, meta: SessionMetadata) => Promise<string>;

// Invoked on logout and on switch-tenant. No-op if the app hasn't wired a
// sessionCreator; in that case the framework never populates a `sid` and
// there's nothing to revoke.
export type SessionRevoker = (sid: string) => Promise<void>;

export type AuthRoutesConfig = {
  membershipQuery: string; // qualified query handler name, e.g. config.membershipQuery
  // Optional: qualified write handler for login. When set, POST /auth/login
  // dispatches to this handler with a guest identity and issues a JWT on
  // success. Handler must return { kind: "auth-session", session: SessionUser }.
  loginHandler?: string;
  // Maps feature-specific login error codes to HTTP status codes. Unknown
  // errors default to 400. Keeps the framework unaware of concrete auth codes.
  loginErrorStatusMap?: Readonly<Record<string, number>>;
  // Rate-limit for POST /auth/login. Defaults to in-memory 10/5min per
  // (ip + email) bucket. Pass `null` to disable (tests, trusted networks).
  loginRateLimit?: LoginRateLimiter | null;
  // Session-lifecycle callbacks. When both are wired the JWT carries a `jti`
  // (sid) and the server can revoke individual sessions (logout, compromise,
  // password-change). When unwired the framework issues plain stateless JWTs.
  // Mirrors the loginRateLimit pattern: feature-owned storage, framework-
  // owned routing.
  sessionCreator?: SessionCreator;
  sessionRevoker?: SessionRevoker;
};

// Extract `ip` and `user-agent` for the sessionCreator.
// Hono's `c.req.header(...)` returns undefined for missing headers; we coerce
// them to "unknown" rather than throwing because auth-routes are a public
// surface and we don't want header-sniffing bugs to break login.
function requestMeta(c: { req: { header(name: string): string | undefined } }): SessionMetadata {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const userAgent = c.req.header("user-agent") ?? "unknown";
  return { ip, userAgent };
}

// Default: in-memory fixed window. Fine for a single Node process; for
// multi-process deployments, inject a Redis-backed LoginRateLimiter instead
// so attempts can't be spread across replicas.
//
// Memory management: entries expire after `windowMs` but the map entries
// themselves linger until something touches them. To stop the map from
// growing unbounded (a single attacker can create entries with different
// `ip|email` buckets at ~req rate), we opportunistically sweep expired
// entries when the map crosses `sweepThreshold` keys and hard-cap total
// entries at `maxEntries` — oldest ones get dropped first.
export function createInMemoryLoginRateLimiter(
  maxAttempts = 10,
  windowMs = 5 * 60_000,
  {
    maxEntries = 10_000,
    sweepThreshold = 1_000,
  }: { maxEntries?: number; sweepThreshold?: number } = {},
): LoginRateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  function sweepExpired(now: number): void {
    for (const [k, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(k);
    }
  }

  function enforceCap(): void {
    // Map iteration is insertion-order, so the oldest entries are first.
    // Drop from the front until we're back under the cap.
    // skip: under the cap, nothing to do
    if (hits.size <= maxEntries) return;
    const toDrop = hits.size - maxEntries;
    let dropped = 0;
    for (const k of hits.keys()) {
      if (dropped >= toDrop) break;
      hits.delete(k);
      dropped++;
    }
  }

  return {
    async check(key) {
      const now = Date.now();
      if (hits.size >= sweepThreshold) sweepExpired(now);

      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        enforceCap();
        return true;
      }
      if (entry.count >= maxAttempts) return false;
      entry.count++;
      return true;
    },
    async reset(key) {
      hits.delete(key);
    },
  };
}

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
    // Default to in-memory limiter unless the caller opted out via null.
    const rateLimiter =
      config.loginRateLimit === null
        ? null
        : (config.loginRateLimit ?? createInMemoryLoginRateLimiter());

    api.post(Routes.authLogin, async (c) => {
      const body = await c.req.json<{ email: string; password: string }>();

      if (rateLimiter) {
        // Bucket by both IP and email so a single guessed password can't
        // block a real user from logging in, but also so one abuser can't
        // just cycle emails.
        const ip =
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
          c.req.header("x-real-ip") ??
          "unknown";
        const key = `${ip}|${(body.email ?? "").toLowerCase()}`;
        const allowed = await rateLimiter.check(key);
        if (!allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
      }

      const result = await dispatcher.write(loginQn, body, GUEST_USER);

      if (!result.isSuccess) {
        // Feature-specific auth reason codes arrive via UnprocessableError.details.reason
        // (e.g. "invalid_credentials", "user_locked"). Fall back to the KumikoError code
        // so unmapped cases still get a sensible status.
        const reason =
          (result.error.details as { reason?: string } | undefined)?.reason ?? result.error.code;
        const status = (statusMap[reason] ?? result.error.httpStatus) as 400 | 401 | 403 | 500;
        return c.json({ isSuccess: false, error: result.error }, status);
      }

      const data = result.data as { kind: "auth-session"; session: SessionUser };

      // Session creation (optional). Creating the session BEFORE signing the
      // JWT is load-bearing: the sid must exist on the server before the
      // token that references it can be handed out, otherwise a fast client
      // could arrive at an auth-middleware check before the insert commits.
      let sessionForJwt: SessionUser = data.session;
      if (config.sessionCreator) {
        const sid = await config.sessionCreator(data.session, requestMeta(c));
        sessionForJwt = { ...data.session, sid };
      }

      const token = await jwt.sign(sessionForJwt);

      if (rateLimiter) {
        const ip =
          c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
          c.req.header("x-real-ip") ??
          "unknown";
        await rateLimiter.reset(`${ip}|${body.email.toLowerCase()}`);
      }

      return c.json({
        isSuccess: true,
        token,
        user: { id: data.session.id, tenantId: data.session.tenantId, roles: data.session.roles },
      });
    });
  }

  // POST /auth/logout — revokes the current session. Requires a valid JWT so
  // the middleware has already populated `user.sid` from the `jti` claim. If
  // the app hasn't wired a sessionRevoker, logout is effectively a no-op on
  // the server — the client can just drop the token.
  api.post(Routes.authLogout, async (c) => {
    const user = getUser(c);
    if (config.sessionRevoker && user.sid) {
      await config.sessionRevoker(user.sid);
    }
    return c.json({ isSuccess: true });
  });

  // GET /auth/tenants — list tenants the current user belongs to
  api.get(Routes.authTenants, async (c) => {
    const user = getUser(c);

    try {
      // System-scoped: membershipQuery is access-locked to system-role.
      const memberships = (await dispatcher.query(
        config.membershipQuery,
        { userId: user.id },
        createSystemUser(user.tenantId),
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
    const body = await c.req.json<{ tenantId: TenantId }>();
    const targetTenantId = body.tenantId;

    if (targetTenantId === user.tenantId) {
      return c.json({ error: "already_in_tenant" }, 400);
    }

    try {
      // Check membership — uses the system identity because membershipQuery is
      // locked to the system role. The auth-route is trusted server code; it
      // asks the question on the user's behalf, not as the user.
      const memberships = (await dispatcher.query(
        config.membershipQuery,
        { userId: user.id },
        createSystemUser(user.tenantId),
      )) as MembershipRow[];

      const membership = memberships.find((m) => m.tenantId === targetTenantId);
      if (!membership) {
        return c.json({ error: "not_a_member" }, 403);
      }

      // Issue new JWT with the target tenant and its roles. Claims MUST be
      // recomputed for the new tenant — stale claims from the previous
      // tenant would leak identity facts across tenancies (e.g. teamId from
      // tenant A accidentally surviving into tenant B's session). The
      // resolver runs each feature's r.authClaims() hook under the new
      // TenantDb scope.
      const targetSession: SessionUser = {
        id: user.id,
        tenantId: targetTenantId,
        roles: membership.roles,
      };
      const claims = await dispatcher.resolveAuthClaims(targetSession);
      let sessionForJwt: SessionUser =
        Object.keys(claims).length > 0 ? { ...targetSession, claims } : targetSession;

      // Session rotation: each tenant-scope gets its own sid. We revoke the
      // outgoing sid BEFORE creating the new one so a failure in the creator
      // doesn't leave the user with two live sessions. Order matters: old
      // out, new in, never both.
      if (config.sessionRevoker && user.sid) {
        await config.sessionRevoker(user.sid);
      }
      if (config.sessionCreator) {
        const sid = await config.sessionCreator(sessionForJwt, requestMeta(c));
        sessionForJwt = { ...sessionForJwt, sid };
      }

      const newToken = await jwt.sign(sessionForJwt);

      return c.json({ token: newToken, tenantId: targetTenantId, roles: membership.roles });
    } catch {
      return c.json({ error: "tenant_switch_not_available" }, 400);
    }
  });

  return api;
}
