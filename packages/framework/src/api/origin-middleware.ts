import type { Context, Next } from "hono";
import { STATE_CHANGING_METHODS } from "./api-constants";
import { getAuthTransport } from "./auth-middleware";

// Canonical comparable form for an Origin / allowlist entry: lowercased, no
// trailing slash. Origin headers are scheme+host(+port) without a path, but
// config entries are hand-written and may carry a stray slash or mixed case.
export function normalizeOrigin(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

// Exact-match against a pre-normalized allowlist. No wildcards by design:
// `*.example.eu` would re-admit the tenant subdomains this guard exists to
// shut out.
export function isOriginAllowed(origin: string, normalizedAllowlist: ReadonlySet<string>): boolean {
  return normalizedAllowlist.has(normalizeOrigin(origin));
}

function rejectOrigin(c: Context): Response {
  return c.json(
    {
      error: {
        code: "origin_not_allowed",
        httpStatus: 403,
        message: "request origin is not allowed",
        i18nKey: "auth.errors.originNotAllowed",
      },
    },
    403,
  );
}

// Server-side Origin-allowlist guard — an additional CSRF-hardening layer on
// top of the double-submit token (csrf-middleware) for deployments that widen
// the auth cookie across subdomains via AuthRoutesConfig.cookieDomain. A wide
// cookie means an XSS on ANY subdomain (e.g. a tenant status page) can read
// the JS-readable kumiko_csrf cookie and forge an authenticated state-changing
// request. Pinning the request Origin to the apex + admin host (never tenant
// subdomains) closes that vector even for "simple requests" (text/plain or
// form-encoded) that skip the CORS preflight and reach the server.
//
// Runs AFTER authMiddleware (reads the authTransport flag) with the same scope
// as the CSRF guard: only cookie-authenticated, state-changing requests.
// Bearer-auth requests skip — browsers cannot set Authorization cross-origin,
// and native clients send no/foreign Origin, so guarding them would be a
// false-positive with no CSRF vector to defend.
export function originMiddleware(allowedOrigins: readonly string[]) {
  const allowlist: ReadonlySet<string> = new Set(allowedOrigins.map(normalizeOrigin));
  return async (c: Context, next: Next) => {
    const transport = getAuthTransport(c);
    if (transport !== "cookie") return next();
    if (!STATE_CHANGING_METHODS.has(c.req.method)) return next();

    const origin = c.req.header("origin");
    if (origin !== undefined) {
      if (isOriginAllowed(origin, allowlist)) return next();
      return rejectOrigin(c);
    }

    // No Origin header — older browsers, and some same-origin POSTs in Safari.
    // Fall back to the Fetch-Metadata Sec-Fetch-Site signal: only an explicit
    // cross-site marker is blocked here (it's a relation, not an origin, so it
    // can't be matched against the allowlist). Everything else (same-site,
    // same-origin, none, absent) falls through to the CSRF token. Note: the
    // CSRF token alone does NOT stop a same-site subdomain XSS — it can read
    // the wide cookie — but that attack uses fetch/XHR, which always sends an
    // Origin header and is already rejected by the allowlist branch above. The
    // residual is only the no-Origin-yet-Sec-Fetch-Site combo, which no current
    // browser emits for state-changing requests.
    if (c.req.header("sec-fetch-site") === "cross-site") return rejectOrigin(c);

    return next();
  };
}

// Fail-closed boot check: a wide cookieDomain shares the JS-readable
// kumiko_csrf cookie across every subdomain, so a subdomain XSS can read it and
// defeat the double-submit CSRF check. Without an Origin allowlist there is no
// server-side barrier left — refuse to boot in that configuration unless the
// operator opts out explicitly. Called once from buildServer.
export function assertOriginGuardConfig(
  auth:
    | { cookieDomain?: string; allowedOrigins?: readonly string[]; unsafeSkipOriginCheck?: boolean }
    | undefined,
): void {
  const widensCookieAcrossSubdomains = Boolean(auth?.cookieDomain);
  const hasAllowlist = (auth?.allowedOrigins?.length ?? 0) > 0;
  const optedOut = auth?.unsafeSkipOriginCheck === true;
  if (widensCookieAcrossSubdomains && !hasAllowlist && !optedOut) {
    throw new Error(
      "[kumiko:boot] auth.cookieDomain widens the session cookie across subdomains, but " +
        "auth.allowedOrigins is empty — the JS-readable kumiko_csrf cookie would be reachable " +
        "from every subdomain (e.g. tenant pages) with no server-side Origin check, defeating " +
        "CSRF protection. Set auth.allowedOrigins to the apex + admin host, or set " +
        "auth.unsafeSkipOriginCheck: true to accept the risk explicitly.",
    );
  }
}
