import type { SessionUser } from "../engine/types/index.ts";
import type { AuthSessionChecker, TokenVerifier } from "./auth-middleware.ts";
import type { ClientIpResolver } from "./client-ip.ts";
import type { PostAuthLandingResolver } from "./post-auth-landing.ts";

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

// Mass-revoke every live session for a user. Used by password-change and
// "sign out everywhere" (sessions feature) and by auth-foundation's
// SessionStore extension point — canonical home so both can re-export
// the same type instead of restating it.
export type SessionMassRevoker = (userId: string) => Promise<number>;

// Status reported by the session-store to the auth-middleware. The concrete
// type lives on auth-middleware to keep the tight coupling visible there;
// auth-routes just re-uses the alias for the AuthRoutesConfig surface.
// "live" → let the request through; anything else → 401 with the status as
// the response reason, so logs/metrics can distinguish "revoked" from
// "expired" from "someone forged a sid that never existed".
export type SessionChecker = AuthSessionChecker;

export type AuthRoutesConfig = {
  membershipQuery: string; // qualified query handler name, e.g. config.membershipQuery
  // Optional: qualified query handler that returns the user row incl. global
  // roles (`roles` as JSON-encoded string[]). When set, switch-tenant calls
  // this query and merges the global roles with the tenant-membership roles
  // — so SystemAdmin (or similar tenant-independent roles) survives the
  // tenant switch. Expected shape: `{id, roles?: string|null}`. Default
  // unset = no merge (backwards-compat for apps without global roles).
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
  // Optional: qualified write handler that runs the login's MFA gate for a
  // tenant switch. Dispatched with the system identity and { userId, tenantId };
  // the handler resolves membership and roles itself; returns { kind: "mfa-gate-clear", roles } (the
  // roles the session is minted with) or the same
  // mfa-challenge / mfa-setup-required shapes as /auth/login. Without it a
  // switch into a tenant where the user holds an MFA-gated role mints a
  // session with no second factor.
  switchTenantMfaGateHandler?: string;
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
  // Optional: qualified write handler generating a TOTP secret + QR for a
  // user blocked at login by MFA enforcement but not yet enrolled (see
  // mfaStatusChecker's setupRequired branch, auth-mfa). When set, POST
  // /auth/mfa/preauth-enable-start dispatches { preauthSetupToken,
  // accountLabel } to this handler with a guest identity — no session is
  // minted, the response is just { setupToken, otpauthUri, recoveryCodes }
  // (same shape as auth-mfa's own enable-start.write.ts).
  mfaPreauthEnableStartHandler?: string;
  // Maps mfaPreauthEnableStartHandler error codes to HTTP status codes,
  // same pattern as mfaVerifyErrorStatusMap.
  mfaPreauthEnableStartErrorStatusMap?: Readonly<Record<string, number>>;
  // Rate-limit for POST /auth/mfa/preauth-enable-start, keyed by client IP.
  // Defaults to in-memory 10/5min. Pass `null` to disable. This route does
  // NOT inherit the generic L2 authEndpointRateLimit on /api/auth/* by
  // default (runProdApp's rateLimit.auth is a separate per-app setting), and a
  // preauthSetupToken is valid for the full setup-token TTL and not
  // single-use until preauth-confirm burns it — an unrate-limited replay
  // means every hit re-derives a fresh TOTP secret + 8 argon2id recovery-
  // code hashes (recovery-codes.ts, Promise.all), a memory-hard CPU
  // amplifier reachable from a single stolen/leaked token.
  mfaPreauthEnableStartRateLimit?: LoginRateLimiter | null;
  // Optional: qualified write handler completing the enrollment started by
  // mfaPreauthEnableStartHandler — takes the secret-carrying setupToken
  // from that step plus a TOTP code. When set, POST /auth/mfa/preauth-
  // confirm dispatches { setupToken, code } to this handler with a guest
  // identity. On success the handler must return { kind: "mfa-preauth-
  // confirm-success", session: SessionUser } and the route mints a JWT
  // exactly like /auth/mfa/verify — this call both finishes enrollment AND
  // completes the login that was blocked by mfa-setup-required. Unlike
  // mfaPreauthEnableStartHandler, THIS is the per-account TOTP-guessing
  // surface the enable-start doc comment refers to — the handler owns its
  // own brute-force cap (mirroring mfaVerifyHandler's), and this route adds
  // its own IP-scoped rate limiter for the same reason mfaVerifyRateLimit
  // exists separately from loginRateLimit.
  mfaPreauthConfirmHandler?: string;
  // Maps mfaPreauthConfirmHandler error codes to HTTP status codes, same
  // pattern as mfaVerifyErrorStatusMap.
  mfaPreauthConfirmErrorStatusMap?: Readonly<Record<string, number>>;
  // Rate-limit for POST /auth/mfa/preauth-confirm, keyed by client IP. Same
  // reasoning as mfaVerifyRateLimit — defaults to in-memory 10/5min, pass
  // `null` to disable.
  mfaPreauthConfirmRateLimit?: LoginRateLimiter | null;
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
  // Resolves bearer tokens (any registered auth-foundation `tokenVerifier`
  // provider — PAT today, future JWT-provider), consulted BEFORE jwt.verify.
  // Wired by run-prod-app/run-dev-app when at least one provider feature is
  // mounted; unwired = no non-JWT bearer auth.
  tokenVerifier?: TokenVerifier;
  // Per-token request-rate limiter for PAT-authenticated requests, keyed by
  // the token id (SessionUser.pat.tokenId). Cookie/JWT requests are unaffected.
  // Reuses the LoginRateLimiter shape (a generic keyed check/reset limiter).
  // Wired by run-prod-app when the PAT feature is mounted; unwired = no PAT
  // rate limiting.
  patRateLimiter?: LoginRateLimiter;
  // Tenant-lifecycle 410 gate — wired by tenant-lifecycle / run-prod-app.
  resolveTenantLifecycleStatus?: import("./auth-middleware.ts").TenantLifecycleStatusResolver;
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
  // Account-unlock flow. When wired, POST
  // /auth/request-account-unlock + /auth/confirm-account-unlock are
  // mounted as public routes. Confirm needs no extra body field
  // (token-only, like email-verification) — the handler only clears the
  // Redis lockout state, no entity write.
  accountUnlock?: AccountUnlockConfig;
  // Self-signup (magic link). When wired, mounts POST
  // /auth/signup-request + /auth/signup-confirm. Confirm returns the JWT
  // cookie + session body like login.
  signup?: SignupConfig;
  // Tenant invite (magic link). Mounts 3 accept routes for the 3 branches
  // (logged-in / anon-existing-email / anon-new-email).
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
  // Force the Secure flag on the session cookies. Default: on when
  // NODE_ENV is "production". Secure cookies without a `cookieDomain` are
  // written under the `__Host-` prefix (`__Host-kumiko_auth` etc.), which a
  // sibling subdomain cannot set or shadow; with a `cookieDomain` or without
  // Secure the plain names are used. buildServer resolves this once.
  secureCookies?: boolean;
  // Domains that previously carried the auth cookies (an earlier `cookieDomain`
  // value). Login and logout additionally send delete headers for these
  // domains, so a stale `Domain=<old>` cookie cannot shadow the new one after
  // the switch (browsers keep name+domain pairs distinct). Remove the entry
  // once the session TTL has passed since the switch: by then every old cookie
  // has expired. Must not equal `cookieDomain`; createAuthRoutes throws if so.
  // Browsers ignore a delete for a domain the responding host is not part of,
  // so an entry only takes effect when login/logout run on that domain or one
  // of its subdomains.
  retiredCookieDomains?: readonly string[];
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
  // Canonical public origin of the app (scheme+host+optional port). Used only
  // when `allowedOrigins` is unset: the Origin guard then admits this origin
  // plus the request's own host, which keeps custom domains working because
  // the session cookies are host-only. runProdApp fills it from
  // `auth.mail.baseUrl` or the APP_BASE_URL env.
  publicOrigin?: string;
  // Explicit opt-out of the fail-closed Origin guard. When `cookieDomain` is
  // set the framework REFUSES TO BOOT unless `allowedOrigins` is configured — a
  // wide cookie without an Origin check is the unguarded-subdomain-XSS footgun.
  // Set this true ONLY for a single-host deployment that shares no untrusted
  // subdomains and genuinely needs the wide cookie anyway; you accept that any
  // subdomain can then forge authenticated state-changing requests. Prefer
  // setting `allowedOrigins`.
  unsafeSkipOriginCheck?: boolean;
  // Number of trusted reverse-proxy hops between the client and this
  // process that APPEND (not overwrite) their peer address to
  // `x-forwarded-for` (e.g. nginx `$proxy_add_x_forwarded_for`). Used to
  // derive the client IP for every auth rate-limiter (login, mfa-verify,
  // preauth-enable-start, preauth-confirm) and for requestMeta's session
  // IP via the shared resolveClientIp (see client-ip.ts for the extraction
  // algorithm). Deprecated in favor of the
  // top-level `trustedProxyHops` on ServerOptions/RunProdAppOptions/
  // RunDevAppOptions, which wins when both are set — kept as a fallback so
  // existing consumers that only set this don't regress. Default 0 = trust
  // no proxy header, only the socket address (or "unknown") counts. Set
  // this to your real proxy hop count (1 for a single ingress/reverse-
  // proxy, 2 for edge-LB + ingress, etc.) when deployed behind a proxy.
  trustedProxyHops?: number;
  // Server-computed post-auth redirect, consulted at login, mfa-verify,
  // mfa-preauth-confirm, signup-confirm, and all three invite-accept branches.
  // Result lands in the response as `landingPath`; an invalid path or a
  // throwing resolver just omits the field (see post-auth-landing.ts).
  postAuthLanding?: PostAuthLandingResolver;
  // Shared resolver instance from buildServer — takes precedence over
  // `trustedProxyHops` so the whole server shares exactly one resolver
  // instance (and warn-once flag) instead of building a private one here.
  // Only standalone callers of createAuthRoutes
  // (no buildServer) should rely on `trustedProxyHops` instead.
  resolver?: ClientIpResolver;
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

export type AccountUnlockConfig = {
  requestHandler: string;
  // Token-only body (mirrors EmailVerificationConfig) — no entity write, so
  // there's no newPassword-equivalent field.
  confirmHandler: string;
};

// Tenant-invite magic link. Three accept branches for clear separation:
//   - acceptHandler: logged-in user accepts via JWT (branch 1)
//   - acceptWithLoginHandler: anonymous user with an existing email (branch 2)
//   - signupCompleteHandler: anonymous user with a new email (branch 3)
// Branches 2+3 mint a JWT analogous to signup-confirm.
export type InviteConfig = {
  // Qualified handler names. invite-create dispatches the invite mail itself
  // via delivery (ctx.notify); the route layer only wires the accept branches.
  readonly acceptHandler: string;
  readonly acceptWithLoginHandler: string;
  readonly signupCompleteHandler: string;
  // Optional: qualified query handler name for the anonymous invite-info
  // lookup (email + hasAccount for a pending invite, token not consumed).
  // When unset, POST /auth/invite-info is not mounted.
  readonly infoHandler?: string;
};

// Magic-link self-signup. Unlike reset/verify NOT HMAC-signed — the token is
// opaque random, Redis is the source of truth. The request handler dispatches
// the activation mail via delivery (ctx.notify); the route only forwards the
// dispatch. Confirm returns `{ kind: "auth-session", session, tenantKey }`
// analogous to loginHandler, so the route can mint a JWT and set cookies
// (auto-login right after activation, no second login round trip).
export type SignupConfig = {
  // Qualified name of the request handler (typically
  // AuthHandlers.signupRequest).
  requestHandler: string;
  // Qualified name of the confirm handler (typically
  // AuthHandlers.signupConfirm). Returns a SessionUser shape — the route
  // handles it like a successful login.
  confirmHandler: string;
};
