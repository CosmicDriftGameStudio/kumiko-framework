import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type Redis from "ioredis";
import { z } from "zod";
import { buildSessionRoles } from "../engine/membership-roles";
import { createSystemUser } from "../engine/system-user";
import { type SessionUser, SYSTEM_TENANT_ID, type TenantId } from "../engine/types";
import { NotFoundError } from "../errors";
import type { Dispatcher } from "../pipeline/dispatcher";
import { parseStringArrayJson } from "../utils/parse-string-array-json";
import { Routes } from "./api-constants";
import {
  AUTH_COOKIE_NAME,
  type AuthSessionChecker,
  type AuthSessionStatus,
  CSRF_COOKIE_NAME,
  getUser,
  type PatResolver,
} from "./auth-middleware";
import type { JwtHelper } from "./jwt";
import { generateToken } from "./tokens";

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
  opts: {
    token: string;
    csrfToken: string;
    sameSite: "lax" | "strict";
    domain?: string | undefined;
    // Cookie lifetime must track the JWT's exp claim — both are issued
    // together, both reference the same session. Callers pass jwt.ttlSeconds
    // so the two never drift apart.
    ttlSeconds: number;
  },
): void {
  const sameSite = opts.sameSite === "strict" ? "Strict" : "Lax";
  const common = {
    secure: cookieSecure(),
    sameSite,
    path: "/",
    maxAge: opts.ttlSeconds,
    ...(opts.domain !== undefined && { domain: opts.domain }),
  } as const;

  // Bei gesetzter Domain zuerst die host-only-Variante invalidieren (analog
  // clearAuthCookies): sonst koexistiert nach einem Deploy mit neuem
  // cookieDomain das alte host-only-Cookie mit dem neuen Domain-Cookie
  // (RFC 6265: name+domain ist distinct) und der Server bindet
  // umgebungsabhängig potenziell ans veraltete host-only-Token.
  if (opts.domain !== undefined) {
    deleteCookie(c, AUTH_COOKIE_NAME, { path: "/" });
    deleteCookie(c, CSRF_COOKIE_NAME, { path: "/" });
  }

  setCookie(c, AUTH_COOKIE_NAME, opts.token, { ...common, httpOnly: true });
  // Intentionally NOT HttpOnly — the web client has to read this from
  // document.cookie to include it in the X-CSRF-Token request header.
  setCookie(c, CSRF_COOKIE_NAME, opts.csrfToken, { ...common, httpOnly: false });
}

function clearAuthCookies(c: Context, domain?: string): void {
  // Beide Varianten löschen: mit Domain (aktuelle Cookies) UND host-only
  // (Bestand aus der Zeit vor cookieDomain) — sonst bleibt nach einem
  // Deploy mit neu gesetztem cookieDomain der alte Cookie liegen und der
  // Logout wirkt nur scheinbar.
  deleteCookie(c, AUTH_COOKIE_NAME, { path: "/" });
  deleteCookie(c, CSRF_COOKIE_NAME, { path: "/" });
  if (domain !== undefined) {
    deleteCookie(c, AUTH_COOKIE_NAME, { path: "/", domain });
    deleteCookie(c, CSRF_COOKIE_NAME, { path: "/", domain });
  }
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

// Body schema for POST /auth/mfa/verify. challengeToken is opaque to the
// framework — it's minted and verified entirely by the mfaVerifyHandler
// (auth-mfa owns the token format, TOTP/recovery-code check, and the
// brute-force cap). code covers both 6-digit TOTP and XXXX-XXXX recovery
// codes (9 chars incl. the dash).
const MfaVerifyBody = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(9),
});

const ResetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

const VerifyEmailBody = z.object({
  token: z.string().min(1),
});

const SignupConfirmBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

const InviteAcceptBody = z.object({
  token: z.string().min(1),
});

const InviteAcceptWithLoginBody = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

const InviteSignupCompleteBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
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
  /** Display-Name des Tenants — liefert die membershipQuery seit dem
   *  tenant-switcher-Fix mit; optional für ältere App-eigene Queries. */
  tenantName?: string;
  tenantKey?: string;
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
  // Optional: qualified write handler completing a two-step (password +
  // TOTP/recovery-code) login. When set, POST /auth/mfa/verify dispatches
  // { challengeToken, code } to this handler with a guest identity. On
  // success the handler must return { kind: "mfa-verify-success", session:
  // SessionUser } and the route mints a JWT exactly like /auth/login.
  // Everything MFA-specific (challenge-token format, TOTP/recovery check,
  // the per-account brute-force cap) is owned by the handler — the
  // framework stays as agnostic about it as it is about password hashing.
  mfaVerifyHandler?: string;
  // Maps mfaVerifyHandler error codes to HTTP status codes, same pattern as
  // loginErrorStatusMap. Unknown errors default to the error's own httpStatus.
  mfaVerifyErrorStatusMap?: Readonly<Record<string, number>>;
  // Rate-limit for POST /auth/mfa/verify, keyed by client IP. Defaults to
  // in-memory 10/5min. Pass `null` to disable. This is DELIBERATELY separate
  // from loginRateLimit: unlike /auth/login (a dispatcher write-handler
  // route that could inherit a handler-level rateLimit), this is a
  // framework route with no handler.rateLimit to fall back on — and it's
  // also separate from any per-account brute-force cap the mfaVerifyHandler
  // enforces itself (see its own doc comment) — IP-scoped abuse protection
  // and per-account guessing protection are different threats, neither
  // substitutes for the other.
  mfaVerifyRateLimit?: LoginRateLimiter | null;
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
  // Resolves bearer Personal Access Tokens (PAT_TOKEN_PREFIX) into a
  // SessionUser, consulted BEFORE jwt.verify. Wired by the
  // personal-access-tokens feature; unwired = PAT auth disabled.
  patResolver?: PatResolver;
  // Per-token request-rate limiter for PAT-authenticated requests, keyed by
  // the token id (SessionUser.pat.tokenId). Cookie/JWT requests are unaffected.
  // Reuses the LoginRateLimiter shape (a generic keyed check/reset limiter).
  // Wired by run-prod-app when the PAT feature is mounted; unwired = no PAT
  // rate limiting.
  patRateLimiter?: LoginRateLimiter;
  // Tenant-lifecycle 410 gate — wired by tenant-lifecycle / run-prod-app.
  resolveTenantLifecycleStatus?: import("./auth-middleware").TenantLifecycleStatusResolver;
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
  // Self-Signup (Magic-Link). Wenn wired, mountet POST
  // /auth/signup-request + /auth/signup-confirm. Confirm returnt JWT-
  // Cookie + Session-Body wie login.
  signup?: SignupConfig;
  // Tenant-Invite (Magic-Link). Mountet 3 accept-Routes für die 3
  // Branches (logged-in / anon-existing-email / anon-new-email).
  invite?: InviteConfig;
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
  // Domain attribute for both auth cookies. Unset (default) = host-only
  // cookie, scoped to the exact host that served the response. Set it to
  // the registrable parent domain (e.g. "example.eu") when login and app
  // live on DIFFERENT subdomains (login on apex, app on admin.) — the
  // browser then sends the session to every subdomain. Careful: that
  // includes ALL subdomains (tenant pages, previews); widen the scope
  // only when the cross-subdomain session is actually required — and pair
  // it with `allowedOrigins` so the server-side Origin guard stays on (a
  // wide cookie makes the JS-readable csrf cookie reachable from every
  // subdomain, weakening the double-submit defence).
  cookieDomain?: string;
  // Origin-allowlist for the server-side CSRF-hardening guard (origin-
  // middleware). When non-empty, every cookie-authenticated, state-changing
  // /api request must carry an `Origin` header that exact-matches one of
  // these entries (scheme+host+optional port, e.g. "https://example.eu", no
  // trailing slash, no wildcards). Requests without an Origin fall back to
  // Sec-Fetch-Site and then to the CSRF token — the guard is defense-in-
  // depth, not a replacement.
  //
  // List ONLY the trusted entry hosts: the apex and the admin host. Do NOT
  // list tenant/public subdomains — with a wide `cookieDomain` they share
  // the session cookie, so an XSS there is exactly the threat this blocks.
  // Empty/unset (default) disables the guard; required only when
  // `cookieDomain` widens the cookie across subdomains.
  allowedOrigins?: readonly string[];
  // Explicit opt-out of the fail-closed Origin guard. When `cookieDomain` is
  // set the framework REFUSES TO BOOT unless `allowedOrigins` is configured — a
  // wide cookie without an Origin check is the unguarded-subdomain-XSS footgun.
  // Set this true ONLY for a single-host deployment that shares no untrusted
  // subdomains and genuinely needs the wide cookie anyway; you accept that any
  // subdomain can then forge authenticated state-changing requests. Prefer
  // setting `allowedOrigins`.
  unsafeSkipOriginCheck?: boolean;
};

export type PasswordResetConfig = {
  // Qualified name of the request handler (the one that emits either
  // { kind: "reset-requested", ... } or { kind: "no-op" }). The handler
  // builds the magic-link and sends the mail via delivery (ctx.notify) — the
  // route only dispatches and returns the silent-success envelope.
  requestHandler: string;
  // Qualified name of the confirm handler (token + newPassword → set).
  confirmHandler: string;
};

export type EmailVerificationConfig = {
  requestHandler: string;
  confirmHandler: string;
};

// Tenant-Invite Magic-Link. Drei Accept-Branches für klare Separation:
//   - acceptHandler: logged-in User akzeptiert via JWT (Branch 1)
//   - acceptWithLoginHandler: anon User mit existing email (Branch 2)
//   - signupCompleteHandler: anon User mit neuer email (Branch 3)
// Branch 2+3 minten JWT analog signup-confirm.
export type InviteConfig = {
  // Qualified handler names. invite-create dispatches the invite mail itself
  // via delivery (ctx.notify); the route layer only wires the accept branches.
  readonly acceptHandler: string;
  readonly acceptWithLoginHandler: string;
  readonly signupCompleteHandler: string;
};

// Magic-Link Self-Signup. Anders als reset/verify NICHT HMAC-signed —
// der Token ist opaque random, Redis ist Source of Truth. The request
// handler dispatches the activation mail via delivery (ctx.notify); the
// route only forwards the dispatch. Confirm returnt
// `{ kind: "auth-session", session, tenantKey }` analog zu loginHandler,
// sodass die Route JWT minten + Cookies setzen kann (Auto-Login direkt
// nach Activation, kein zweiter login-Roundtrip).
export type SignupConfig = {
  // Qualified name of the request handler (typisch
  // AuthHandlers.signupRequest).
  requestHandler: string;
  // Qualified name of the confirm handler (typisch
  // AuthHandlers.signupConfirm). Returnt SessionUser-Shape — die
  // Route wickelt das wie einen erfolgreichen login.
  confirmHandler: string;
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

// Redis-backed sibling of createInMemoryLoginRateLimiter — same fixed-window
// semantics (count <= maxAttempts allows, window anchored on first hit), but
// shared across replicas via INCR/PEXPIRE instead of an in-process Map.
// runProdApp defaults to this: an in-memory limiter only rate-limits within
// a single instance, so a multi-replica prod deployment would silently give
// each replica its own bucket. namespace separates the login-key keyspace
// from the mfa-verify one (they share the same LoginRateLimiter shape but
// key on different values).
export function createRedisLoginRateLimiter(
  redis: Redis,
  maxAttempts = 10,
  windowMs = 5 * 60_000,
  namespace = "login",
): LoginRateLimiter {
  const prefix = `kumiko:auth:ratelimit:${namespace}:`;

  return {
    async check(key) {
      const redisKey = `${prefix}${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.pexpire(redisKey, windowMs);
      }
      return count <= maxAttempts;
    },
    async reset(key) {
      await redis.del(`${prefix}${key}`);
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
  const cookieDomain = config.cookieDomain;

  // Shared tail of every route that ends a request logged-in: create the
  // session record (if wired), sign the JWT, set the auth+csrf cookies. Was
  // duplicated 5x (login/signup-confirm/invite-accept-with-login/invite-
  // signup-complete/switch-tenant) — extracted so a 6th caller (mfa-verify)
  // doesn't grow it to 6.
  async function mintSessionAndRespond(c: Context, session: SessionUser): Promise<string> {
    let sessionForJwt = session;
    if (config.sessionCreator) {
      const sid = await config.sessionCreator(session, requestMeta(c));
      sessionForJwt = { ...session, sid };
    }
    const token = await jwt.sign(sessionForJwt);
    const csrfToken = generateToken();
    setAuthCookies(c, {
      token,
      csrfToken,
      sameSite: cookieSameSite,
      domain: cookieDomain,
      ttlSeconds: jwt.ttlSeconds,
    });
    return token;
  }

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

      // @cast-boundary engine-payload — generic dispatcher.write result for
      // login. Three possible shapes: a straight session, an MFA challenge
      // when the loginHandler is wired with a second-factor gate, or a hard
      // block when enforcement policy demands MFA but the user never
      // enrolled (see auth-mfa's config.ts for why this has no in-band
      // recovery yet).
      const data = result.data as
        | { kind: "auth-session"; session: SessionUser }
        | { kind: "mfa-challenge"; challengeToken: string }
        | { kind: "mfa-setup-required" };

      if (data.kind === "mfa-setup-required") {
        // No session, no challenge — the client must show an
        // enrollment-required message. No rate-limit reset (same reasoning
        // as the mfa-challenge branch below).
        return c.json({ isSuccess: true, mfaSetupRequired: true });
      }

      if (data.kind === "mfa-challenge") {
        // No session minted yet — no cookies, no token. The client must
        // complete /auth/mfa/verify with this token before it gets either.
        // Rate-limit counter is NOT reset here: a "correct password, wrong/
        // no TOTP yet" outcome hasn't proven the caller owns the account any
        // more than a wrong password did.
        return c.json({ isSuccess: true, mfaRequired: true, challengeToken: data.challengeToken });
      }

      // Session creation (optional) + JWT sign + cookies — see
      // mintSessionAndRespond. Creating the session BEFORE signing the JWT
      // is load-bearing: the sid must exist on the server before the token
      // that references it can be handed out, otherwise a fast client could
      // arrive at an auth-middleware check before the insert commits.
      const token = await mintSessionAndRespond(c, data.session);

      if (rateLimiter) {
        await rateLimiter.reset(rateLimitKey);
      }

      return c.json({
        isSuccess: true,
        token,
        user: { id: data.session.id, tenantId: data.session.tenantId, roles: data.session.roles },
      });
    });
  }

  // POST /auth/mfa/verify — completes a two-step login. Mirrors /auth/login
  // structurally (public, GUEST_USER dispatch, mintSessionAndRespond on
  // success) but with its OWN rate limiter (mfaVerifyRateLimit) — this route
  // never goes through a dispatcher write-handler's own rateLimit config,
  // so without this it would have NO rate limiting at all. Per-account
  // brute-force protection (capping wrong-code guesses against one
  // still-valid challenge token) is a separate mechanism the handler itself
  // owns — see AuthRoutesConfig.mfaVerifyHandler's doc comment.
  if (config.mfaVerifyHandler) {
    const mfaVerifyQn = config.mfaVerifyHandler;
    const statusMap = config.mfaVerifyErrorStatusMap ?? {};
    const rateLimiter =
      config.mfaVerifyRateLimit === null
        ? null
        : (config.mfaVerifyRateLimit ?? createInMemoryLoginRateLimiter());

    api.post(Routes.authMfaVerify, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = MfaVerifyBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const body = parsed.data;

      const clientIp =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown";

      if (rateLimiter) {
        const allowed = await rateLimiter.check(clientIp);
        if (!allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
      }

      const result = await dispatcher.write(mfaVerifyQn, body, GUEST_USER);

      if (!result.isSuccess) {
        // @cast-boundary error-details — KumikoError.details shape is per-error
        const reason =
          (result.error.details as { reason?: string } | undefined)?.reason ?? result.error.code;
        // @cast-boundary engine-payload — statusMap value union narrows to the http-status union
        const status = (statusMap[reason] ?? result.error.httpStatus) as
          | 400
          | 401
          | 403
          | 422
          | 429
          | 500;
        return c.json({ isSuccess: false, error: result.error }, status);
      }

      // @cast-boundary engine-payload — generic dispatcher.write result for mfa-verify handler
      const data = result.data as { kind: "mfa-verify-success"; session: SessionUser };

      const token = await mintSessionAndRespond(c, data.session);

      if (rateLimiter) {
        await rateLimiter.reset(clientIp);
      }

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
    });
    registerTokenConfirmRoute({
      api,
      dispatcher,
      path: Routes.authVerifyEmail,
      confirmHandler: ev.confirmHandler,
      schema: VerifyEmailBody,
    });
  }

  // Self-Signup (Magic-Link). Request mountet wie reset/verify den
  // silent-success-Pfad mit Token-Mail. Confirm ist anders: returnt
  // SessionUser → die Route mintet JWT + setzt Cookies (Auto-Login
  // direkt nach Activation, kein zweiter Login-Roundtrip nötig).
  if (config.signup) {
    const sg = config.signup;
    registerTokenRequestRoute({
      api,
      dispatcher,
      path: Routes.authSignupRequest,
      requestHandler: sg.requestHandler,
    });

    api.post(Routes.authSignupConfirm, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = SignupConfirmBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }

      const result = await dispatcher.write(sg.confirmHandler, parsed.data, GUEST_USER);

      if (!result.isSuccess) {
        // 422 für invalid_signup_token (handler-level UnprocessableError).
        // @cast-boundary engine-payload — KumikoError.httpStatus narrows to the http-status union
        const status = result.error.httpStatus as 400 | 401 | 403 | 422 | 500;
        return c.json({ isSuccess: false, error: result.error }, status);
      }

      // @cast-boundary engine-payload — generic dispatcher.write result for signup-confirm
      const data = result.data as {
        kind: "auth-session";
        session: SessionUser;
        tenantKey: string;
      };

      // Session creation + JWT sign + cookies — see mintSessionAndRespond.
      const token = await mintSessionAndRespond(c, data.session);

      return c.json({
        isSuccess: true,
        token,
        user: {
          id: data.session.id,
          tenantId: data.session.tenantId,
          roles: data.session.roles,
        },
        // tenantKey für Post-Signup-Redirect zu /<tenantKey>/.
        // Anders als der login-response der nur `tenants[]` braucht
        // (User wählt im Switcher), kennt der signup nur EINE
        // membership — die Frontend-UI nimmt das direkt als Redirect-
        // Target.
        tenantKey: data.tenantKey,
      });
    });
  }

  // Tenant-Invite Magic-Link. 3 separate Routes für 3 Accept-Branches:
  if (config.invite) {
    const inv = config.invite;

    // Branch 1: logged-in User klickt Invite-Link → Membership-Add im
    // invited Tenant (NICHT Tenant-Switch — User bleibt in seiner
    // aktuellen Session, kann später via Tenant-Switcher wechseln).
    // Requires JWT (siehe PUBLIC_API_PATHS — invite-accept ist NICHT
    // public, im Gegensatz zu acceptWithLogin/signupComplete).
    api.post(Routes.authInviteAccept, async (c) => {
      const user = getUser(c);
      const raw = await c.req.json().catch(() => null);
      const parsed = InviteAcceptBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const result = await dispatcher.write(inv.acceptHandler, parsed.data, user);
      if (!result.isSuccess) {
        // @cast-boundary engine-payload — KumikoError.httpStatus
        const status = result.error.httpStatus as 400 | 401 | 403 | 422 | 500;
        return c.json({ isSuccess: false, error: result.error }, status);
      }
      // @cast-boundary engine-payload — generic dispatcher.write result
      const data = result.data as {
        kind: "invite-accepted";
        tenantId: TenantId;
        role: string;
        alreadyMember: boolean;
      };
      return c.json({
        isSuccess: true,
        tenantId: data.tenantId,
        role: data.role,
        alreadyMember: data.alreadyMember,
      });
    });

    // Branch 2: anon User mit existing email — Login + Accept in einem
    // Roundtrip. JWT-mint analog signup-confirm.
    api.post(Routes.authInviteAcceptWithLogin, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = InviteAcceptWithLoginBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const result = await dispatcher.write(inv.acceptWithLoginHandler, parsed.data, GUEST_USER);
      if (!result.isSuccess) {
        const status = result.error.httpStatus as 400 | 401 | 403 | 422 | 500; // @cast-boundary engine-payload
        return c.json({ isSuccess: false, error: result.error }, status);
      }
      const data = result.data as {
        kind: "auth-session";
        session: SessionUser;
        tenantId: TenantId;
        role: string;
      }; // @cast-boundary engine-payload
      const token = await mintSessionAndRespond(c, data.session);
      return c.json({
        isSuccess: true,
        token,
        user: {
          id: data.session.id,
          tenantId: data.session.tenantId,
          roles: data.session.roles,
        },
        tenantId: data.tenantId,
        role: data.role,
      });
    });

    // Branch 3: anon User mit neuer email — User+Membership entstehen,
    // KEIN neuer Tenant. JWT-mint.
    api.post(Routes.authInviteSignupComplete, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = InviteSignupCompleteBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const result = await dispatcher.write(inv.signupCompleteHandler, parsed.data, GUEST_USER);
      if (!result.isSuccess) {
        const status = result.error.httpStatus as 400 | 401 | 403 | 422 | 500; // @cast-boundary engine-payload
        return c.json({ isSuccess: false, error: result.error }, status);
      }
      const data = result.data as {
        kind: "auth-session";
        session: SessionUser;
        tenantId: TenantId;
        role: string;
      }; // @cast-boundary engine-payload
      const token = await mintSessionAndRespond(c, data.session);
      return c.json({
        isSuccess: true,
        token,
        user: {
          id: data.session.id,
          tenantId: data.session.tenantId,
          roles: data.session.roles,
        },
        tenantId: data.tenantId,
        role: data.role,
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
    // Clear cookies on the cookie-transport path. Idempotent — clearing a
    // missing cookie is a no-op, so bearer-only clients aren't affected.
    clearAuthCookies(c, cookieDomain);
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
          globalRoles = parseStringArrayJson(raw);
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
    // buildSessionRoles calls stripForbiddenMembershipRoles internally and
    // strips reserved roles from the membership side only — globalRoles
    // (where SystemAdmin legitimately lives) is never filtered. Backstop for a
    // membership role that a projection rebuild resurrected past command-time
    // validation (see engine/membership-roles).
    const mergedRoles = buildSessionRoles(globalRoles, membership.roles);
    const targetSession: SessionUser = {
      id: user.id,
      tenantId: targetTenantId,
      roles: mergedRoles,
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

    return c.json({ token: newToken, tenantId: targetTenantId, roles: mergedRoles });
  });

  return api;
}

// --- shared route builders for token flows ---------------------------------
// Password-reset, email-verification and signup share the exact same request
// HTTP-shape: parse body → dispatch the request handler → always-200 (no
// enumeration). The handler mints the token AND dispatches the magic-link mail
// via delivery (ctx.notify); the route never sees the token. confirm-route
// validates the token + does the state change → typed failure or 200. Keeping
// the silent-success invariant in one place means changing how the framework
// handles "invalid_body" on a public token endpoint is one edit, not three.

function registerTokenRequestRoute(opts: {
  api: Hono;
  dispatcher: Dispatcher;
  path: string;
  requestHandler: string;
}): void {
  const body = RequestTokenBody;
  opts.api.post(opts.path, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = body.safeParse(raw);
    // Malformed body → silent success. A probing client mustn't learn
    // anything from the shape of their input.
    if (!parsed.success) return c.json({ isSuccess: true });

    // The handler dispatches the magic-link mail via delivery before returning.
    // Handler-level failures (only legitimate reason: misconfiguration) are
    // silently swallowed — observability logs capture them for ops — so the
    // response shape stays uniform for unknown vs. known emails.
    await opts.dispatcher.write(opts.requestHandler, { email: parsed.data.email }, GUEST_USER);

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
      const status = result.error.httpStatus as 400 | 401 | 403 | 422 | 500; // @cast-boundary engine-payload
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
