import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createSystemUser } from "../engine/system-user";
import { type SessionUser, SYSTEM_TENANT_ID, type TenantId } from "../engine/types";
import { NotFoundError } from "../errors";
import type { Dispatcher } from "../pipeline/dispatcher";
import { Routes } from "./api-constants";
import {
  AUTH_COOKIE_NAME,
  type AuthSessionChecker,
  type AuthSessionStatus,
  CSRF_COOKIE_NAME,
  getUser,
} from "./auth-middleware";
import type { JwtHelper } from "./jwt";
import { generateToken } from "./tokens";

// Cookie lifetime must track the JWT's exp claim — both are issued together,
// both reference the same session. jwt.ts's createJwtHelper hardcodes
// setExpirationTime("24h"); if that ever becomes configurable this constant
// follows it.
const JWT_TTL_SECONDS = 24 * 60 * 60;

// Resolves the Secure cookie flag. Locked off in dev/test so Playwright
// against http://localhost:… can actually receive the cookie. Production
// flips it on — browsers drop Secure cookies on http, so a misconfigured
// prod deploy would silently break login rather than fail loud.
function cookieSecure(): boolean {
  return process.env["NODE_ENV"] === "production";
}

// Double-entry cookie write used at login and switch-tenant. kumiko_auth is
// the HttpOnly carrier of the JWT; kumiko_csrf is the JS-readable token the
// web client echoes in X-CSRF-Token on every state-changing request. Both
// cookies share lifetime and SameSite so a stale auth-cookie can't outlive
// its csrf partner (or vice versa) and leave the client in a half-logged-in
// state that would trip the csrf-middleware on every retry.
function setAuthCookies(
  c: Context,
  opts: { token: string; csrfToken: string; sameSite: "lax" | "strict" },
): void {
  const sameSite = opts.sameSite === "strict" ? "Strict" : "Lax";
  const common = {
    secure: cookieSecure(),
    sameSite,
    path: "/",
    maxAge: JWT_TTL_SECONDS,
  } as const;

  setCookie(c, AUTH_COOKIE_NAME, opts.token, { ...common, httpOnly: true });
  // Intentionally NOT HttpOnly — the web client has to read this from
  // document.cookie to include it in the X-CSRF-Token request header.
  setCookie(c, CSRF_COOKIE_NAME, opts.csrfToken, { ...common, httpOnly: false });
}

function clearAuthCookies(c: Context): void {
  deleteCookie(c, AUTH_COOKIE_NAME, { path: "/" });
  deleteCookie(c, CSRF_COOKIE_NAME, { path: "/" });
}

// Body schema for POST /auth/login. Enforced BEFORE rate-limit so that a
// malformed body (`email: 42`, missing password, …) returns 400 instead of
// crashing on `.toLowerCase()` and leaking a 500 that never increments the
// login counter — previous wiring let attackers spam the endpoint without
// tripping the bucket.
const LoginBody = z.object({
  email: z.string().min(1),
  password: z.string(),
});

const ResetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

const VerifyEmailBody = z.object({
  token: z.string().min(1),
});

// Shape guard for "handler not registered" — the only legitimate reason to
// fall back to a single-tenant reply on /auth/tenants or /auth/switch-tenant.
// Every other error (DB down, revoker throws, access denied, …) has to
// propagate — otherwise we'd silently paper over outages.
function isUnknownHandlerError(e: unknown): boolean {
  if (!(e instanceof NotFoundError)) return false;
  // @cast-boundary error-details — KumikoError.details shape is per-error
  const details = e.details as { entity?: string } | undefined;
  return details?.entity === "handler";
}

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

// Status reported by the session-store to the auth-middleware. The concrete
// type lives on auth-middleware to keep the tight coupling visible there;
// auth-routes just re-uses the alias for the AuthRoutesConfig surface.
// "live" → let the request through; anything else → 401 with the status as
// the response reason, so logs/metrics can distinguish "revoked" from
// "expired" from "someone forged a sid that never existed".
export type SessionChecker = AuthSessionChecker;
export type { AuthSessionStatus };

export type AuthRoutesConfig = {
  membershipQuery: string; // qualified query handler name, e.g. config.membershipQuery
  // Optional: qualified query handler that returns the user-row inkl.
  // globaler Rollen (`roles` als JSON-encoded string[]). Wenn gesetzt,
  // ruft switch-tenant diese Query und mergt die globalen Rollen mit den
  // tenant-membership-Rollen — so überlebt SystemAdmin (oder ähnliche
  // tenant-unabhängige Rollen) den Tenant-Switch. Erwartete Shape:
  // `{id, roles?: string|null}`. Default nicht gesetzt = kein merge
  // (backwards-compat für Apps ohne globale Rollen).
  userQuery?: string;
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
  // Consulted by the auth-middleware on every authenticated request when the
  // incoming JWT carries a `jti`. Paired with sessionCreator: create a sid
  // at login, check it here on every request. Leaving this empty disables
  // the revocation path — old JWTs stay valid until they expire naturally.
  sessionChecker?: SessionChecker;
  // When true, a JWT WITHOUT a sid is rejected. Use during deploy-rollouts
  // once all fresh JWTs emit a sid and the legacy stateless tokens are
  // expected to have expired. Default false keeps old tokens working.
  sessionStrictMode?: boolean;
  // Password-reset flow. When wired, POST /auth/request-password-reset and
  // POST /auth/reset-password are mounted as public routes. The framework
  // dispatches to the feature-level handlers (authoring QNs typically come
  // from `AuthHandlers.requestPasswordReset` / `.resetPassword`) and
  // invokes sendResetEmail with the freshly-signed token when a user was
  // actually found. Silent-success: every response to request-reset is
  // { isSuccess: true } regardless of whether the email existed.
  passwordReset?: PasswordResetConfig;
  // Email-verification flow. Symmetric to passwordReset.
  emailVerification?: EmailVerificationConfig;
  // SameSite flag for the HttpOnly auth cookie + JS-readable csrf cookie
  // issued by /auth/login and /auth/switch-tenant.
  //   "lax"    (default) — blocks cross-site POSTs entirely (which is what
  //            CSRF relies on) while allowing top-level GET navigation
  //            from external sites. Email deep-links (invite, magic-link,
  //            notification click) keep working.
  //   "strict" — blocks the cookie on ANY cross-site navigation including
  //            top-level GETs. Strongest CSRF control but silently breaks
  //            email deep-links — opt-in for banking / high-security apps
  //            that don't ship deep-linkable emails.
  // The framework always pairs the cookie with a Double-Submit CSRF token
  // (see csrf-middleware), so "lax" is defense-in-depth, not defense-alone.
  cookieSameSite?: "lax" | "strict";
};

export type PasswordResetConfig = {
  // Qualified name of the request handler (the one that emits either
  // { kind: "reset-requested", ... } or { kind: "no-op" }).
  requestHandler: string;
  // Qualified name of the confirm handler (token + newPassword → set).
  confirmHandler: string;
  // Invoked only when the request handler returns kind=reset-requested.
  // Given the signed token + target email, the callback builds the URL
  // into the caller's app and hands it to whatever delivery channel the
  // app wires up. Errors bubble as 5xx so silent drop-on-send can't hide
  // an outgoing-mail outage behind a green response.
  sendResetEmail: (args: { email: string; resetUrl: string; expiresAt: string }) => Promise<void>;
  // Base URL of the app that hosts the reset form. The route appends
  // `?token=…` so you should NOT include a trailing `?` or `#`. Example:
  //   "https://app.example.com/reset-password"
  appResetUrl: string;
};

export type EmailVerificationConfig = {
  requestHandler: string;
  confirmHandler: string;
  sendVerificationEmail: (args: {
    email: string;
    verificationUrl: string;
    expiresAt: string;
  }) => Promise<void>;
  // URL of the app page that receives the `?token=…` parameter and POSTs
  // it to /auth/verify-email on submit.
  appVerifyUrl: string;
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
  // Default to "lax": CSRF control comes from the double-submit token, and
  // "lax" keeps email deep-links (invite, magic-link, notification click)
  // working. High-security apps can opt into "strict" — see AuthRoutesConfig.
  const cookieSameSite = config.cookieSameSite ?? "lax";

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
      const raw = await c.req.json().catch(() => null);
      const parsed = LoginBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const body = parsed.data;

      // Client IP derivation is shared between rate-limit check and reset,
      // so compute once. Falls back to "unknown" when no proxy header is
      // present — consistent bucket for direct-to-server test setups.
      const clientIp =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown";
      const rateLimitKey = `${clientIp}|${body.email.toLowerCase()}`;

      if (rateLimiter) {
        // Bucket by both IP and email so a single guessed password can't
        // block a real user from logging in, but also so one abuser can't
        // just cycle emails.
        const allowed = await rateLimiter.check(rateLimitKey);
        if (!allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
      }

      const result = await dispatcher.write(loginQn, body, GUEST_USER);

      if (!result.isSuccess) {
        // Feature-specific auth reason codes arrive via UnprocessableError.details.reason
        // (e.g. "invalid_credentials", "user_locked"). Fall back to the KumikoError code
        // so unmapped cases still get a sensible status.
        // @cast-boundary error-details — KumikoError.details shape is per-error
        const reason =
          (result.error.details as { reason?: string } | undefined)?.reason ?? result.error.code;
        // @cast-boundary engine-payload — statusMap value union narrows to the http-status union
        const status = (statusMap[reason] ?? result.error.httpStatus) as 400 | 401 | 403 | 500;
        return c.json({ isSuccess: false, error: result.error }, status);
      }

      // @cast-boundary engine-payload — generic dispatcher.write result for auth-session handler
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
        await rateLimiter.reset(rateLimitKey);
      }

      // Cookie transport (web): set HttpOnly auth cookie + JS-readable csrf
      // cookie. Bearer transport (native) reads the token from the body
      // below — the token is returned for both, so a Bearer client that
      // ignores Set-Cookie keeps working without any server-side knowledge
      // of which transport this client will use next.
      const csrfToken = generateToken();
      setAuthCookies(c, { token, csrfToken, sameSite: cookieSameSite });

      return c.json({
        isSuccess: true,
        token,
        user: { id: data.session.id, tenantId: data.session.tenantId, roles: data.session.roles },
      });
    });
  }

  // POST /auth/request-password-reset + /auth/reset-password — public.
  // Silent-success on request (no enumeration), typed failure on confirm.
  // Rate-limit covered via config.rateLimit.auth (Sprint G.5 L2, /auth/*).
  if (config.passwordReset) {
    const pr = config.passwordReset;
    registerTokenRequestRoute({
      api,
      dispatcher,
      path: Routes.authRequestPasswordReset,
      requestHandler: pr.requestHandler,
      successKind: "reset-requested",
      appBaseUrl: pr.appResetUrl,
      sendEmail: ({ email, url, expiresAt }) =>
        pr.sendResetEmail({ email, resetUrl: url, expiresAt }),
    });
    registerTokenConfirmRoute({
      api,
      dispatcher,
      path: Routes.authResetPassword,
      confirmHandler: pr.confirmHandler,
      schema: ResetPasswordBody,
    });
  }

  // Email-verification mirrors password-reset.
  if (config.emailVerification) {
    const ev = config.emailVerification;
    registerTokenRequestRoute({
      api,
      dispatcher,
      path: Routes.authRequestEmailVerification,
      requestHandler: ev.requestHandler,
      successKind: "verification-requested",
      appBaseUrl: ev.appVerifyUrl,
      sendEmail: ({ email, url, expiresAt }) =>
        ev.sendVerificationEmail({ email, verificationUrl: url, expiresAt }),
    });
    registerTokenConfirmRoute({
      api,
      dispatcher,
      path: Routes.authVerifyEmail,
      confirmHandler: ev.confirmHandler,
      schema: VerifyEmailBody,
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
    // Clear cookies on the cookie-transport path. Idempotent — clearing a
    // missing cookie is a no-op, so bearer-only clients aren't affected.
    clearAuthCookies(c);
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
    const body = await c.req.json<{ tenantId: TenantId }>();
    const targetTenantId = body.tenantId;

    if (targetTenantId === user.tenantId) {
      return c.json({ error: "already_in_tenant" }, 400);
    }

    // Check membership — uses the system identity because membershipQuery is
    // locked to the system role. The auth-route is trusted server code; it
    // asks the question on the user's behalf, not as the user.
    let memberships: MembershipRow[];
    try {
      // @cast-boundary engine-payload — generic dispatcher.query result
      memberships = (await dispatcher.query(
        config.membershipQuery,
        { userId: user.id },
        createSystemUser(user.tenantId),
      )) as MembershipRow[];
    } catch (e) {
      // No membershipQuery wired → switching tenants is just not offered in
      // this deployment. Any other error propagates so a broken query handler
      // surfaces as a real 5xx instead of a misleading 400.
      if (!isUnknownHandlerError(e)) throw e;
      return c.json({ error: "tenant_switch_not_available" }, 400);
    }

    const membership = memberships.find((m) => m.tenantId === targetTenantId);
    if (!membership) {
      return c.json({ error: "not_a_member" }, 403);
    }

    // Globale Rollen aus user-feature lesen wenn userQuery wired —
    // tenant-unabhängige Rollen (SystemAdmin etc.) überleben so den
    // tenant-switch. `parseRoles` liegt utils-side, hier inline-deserialize
    // damit das Framework keine bundled-features-Imports kriegt.
    let globalRoles: readonly string[] = [];
    if (config.userQuery) {
      try {
        // @cast-boundary engine-payload — dispatcher.query returnt unknown,
        // userQuery liefert per AuthUserRow-Contract eine row mit roles-spalte.
        const userRow = (await dispatcher.query(
          config.userQuery,
          { id: user.id },
          createSystemUser(user.tenantId),
        )) as { roles?: string | null } | null;
        const raw = userRow?.roles;
        if (typeof raw === "string" && raw.length > 0) {
          // @cast-boundary db-row — userTable.roles is JSON-encoded string[] per AuthUserRow contract
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed) && parsed.every((r) => typeof r === "string")) {
            globalRoles = parsed;
          }
        }
      } catch (e) {
        // Non-fatal: globale Rollen kann nicht aufgelöst werden → switch
        // läuft weiter mit nur tenant-rollen. Server-error mit nur dem
        // Cause ohne Stack hochwerfen wäre für die UX schlimmer als ein
        // Tenant-Switch ohne SystemAdmin (User merkt's und meldet's). Log
        // it via the dispatcher so Ops sieht's.
        if (!isUnknownHandlerError(e)) throw e;
      }
    }

    // Issue new JWT with the target tenant and its roles. Claims MUST be
    // recomputed for the new tenant — stale claims from the previous
    // tenant would leak identity facts across tenancies (e.g. teamId from
    // tenant A accidentally surviving into tenant B's session). The
    // resolver runs each feature's r.authClaims() hook under the new
    // TenantDb scope.
    const mergedRoles = Array.from(new Set([...globalRoles, ...membership.roles]));
    const targetSession: SessionUser = {
      id: user.id,
      tenantId: targetTenantId,
      roles: mergedRoles,
    };
    const claims = await dispatcher.resolveAuthClaims(targetSession);
    let sessionForJwt: SessionUser =
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
    if (config.sessionCreator) {
      const sid = await config.sessionCreator(sessionForJwt, requestMeta(c));
      sessionForJwt = { ...sessionForJwt, sid };
    }

    const newToken = await jwt.sign(sessionForJwt);

    // Rotate both cookies in lock-step with the new JWT. A fresh csrfToken
    // is minted so a compromised csrf-value (e.g. leaked via a bug in the
    // app's JS) can't cross a tenant boundary. Bearer-only clients get
    // the new token in the body below — their Set-Cookie is a no-op
    // because the browser never sent cookies.
    const csrfToken = generateToken();
    setAuthCookies(c, { token: newToken, csrfToken, sameSite: cookieSameSite });

    return c.json({ token: newToken, tenantId: targetTenantId, roles: mergedRoles });
  });

  return api;
}

// --- shared route builders for token flows ---------------------------------
// Password-reset and email-verification share the exact same HTTP-shape:
// request-route emits a token → optional sendEmail callback → silent-success,
// confirm-route validates token + does the state change → typed failure or
// 200. Before this extraction both flows carried ~45 LOC of nearly-identical
// body-parse / dispatch / url-build / response plumbing. The helpers keep
// the public-facing silent-success invariant in one place — changing how
// the framework handles "invalid_body" on a public token endpoint is now
// one edit, not two.

type TokenRequestData = {
  kind: string;
  email: string;
  token: string;
  expiresAt: string;
};

type TokenNoOp = { kind: "no-op" };

function registerTokenRequestRoute(opts: {
  api: Hono;
  dispatcher: Dispatcher;
  path: string;
  requestHandler: string;
  // Discriminator the feature handler emits when it actually minted a token
  // (vs. the silent no-op for unknown/already-handled users).
  successKind: string;
  // Base URL of the receiving app page. `?token=…` is appended with proper
  // separator handling so the caller's URL may or may not carry existing
  // query params.
  appBaseUrl: string;
  sendEmail: (args: { email: string; url: string; expiresAt: string }) => Promise<void>;
}): void {
  const body = RequestTokenBody;
  opts.api.post(opts.path, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = body.safeParse(raw);
    // Malformed body → silent success. A probing client mustn't learn
    // anything from the shape of their input.
    if (!parsed.success) return c.json({ isSuccess: true });

    const result = await opts.dispatcher.write(
      opts.requestHandler,
      { email: parsed.data.email },
      GUEST_USER,
    );

    // Handler-level failures (only legitimate reason: misconfiguration) are
    // silently swallowed — observability logs capture them for ops.
    if (result.isSuccess) {
      // @cast-boundary engine-payload — generic dispatcher.write result narrowed by handler-emitted kind
      const data = result.data as TokenRequestData | TokenNoOp;
      if (data.kind === opts.successKind) {
        // TS narrowt nicht durch generic successKind (string, kein literal) —
        // die kind-Gleichheit garantiert den TokenRequestData-Branch hier.
        const requested = data as TokenRequestData; // @cast-boundary engine-payload
        const sep = opts.appBaseUrl.includes("?") ? "&" : "?";
        const url = `${opts.appBaseUrl}${sep}token=${encodeURIComponent(requested.token)}`;
        await opts.sendEmail({
          email: requested.email,
          url,
          expiresAt: requested.expiresAt,
        });
      }
    }

    return c.json({ isSuccess: true });
  });
}

function registerTokenConfirmRoute(opts: {
  api: Hono;
  dispatcher: Dispatcher;
  path: string;
  confirmHandler: string;
  // Endpoint-specific body shape (reset has `newPassword`, verify doesn't).
  schema: typeof ResetPasswordBody | typeof VerifyEmailBody;
}): void {
  opts.api.post(opts.path, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ isSuccess: false, error: "invalid_body" }, 400);
    }
    const result = await opts.dispatcher.write(opts.confirmHandler, parsed.data, GUEST_USER);
    if (!result.isSuccess) {
      const status = result.error.httpStatus as 400 | 401 | 403 | 422 | 500;
      return c.json({ isSuccess: false, error: result.error }, status);
    }
    return c.json({ isSuccess: true });
  });
}

// Shared request-body shape for request-password-reset + request-email-
// verification. Extracted so the two flows stay in sync when the schema
// gains optional fields (locale, deviceId, …).
const RequestTokenBody = z.object({
  email: z.email(),
});
