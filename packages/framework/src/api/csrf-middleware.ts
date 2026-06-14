import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { STATE_CHANGING_METHODS } from "./api-constants";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, getAuthTransport } from "./auth-middleware";

// Constant-time byte compare. `a !== b` short-circuits at the first
// differing byte and leaks the common prefix length to anyone who can
// time requests — in principle exploitable against sufficiently small
// tokens. CSRF tokens are UUIDs so the practical risk is low, but this
// is the standard production pattern for any secret-vs-secret compare.
// Length-check first because timingSafeEqual throws on size mismatch;
// the length itself isn't a secret (the UUID format is known).
const encoder = new TextEncoder();
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

// Double-submit CSRF guard. Runs AFTER authMiddleware — reads the
// authTransport flag set there. Only enforces on cookie-authenticated,
// state-changing requests. Bearer-auth requests skip the check because
// browsers cannot set the Authorization header on cross-origin requests
// (same-origin policy), so there is no CSRF vector to defend against.
//
// Mechanic: the framework sets two cookies on login — `kumiko_auth`
// (HttpOnly, carries the JWT) and `kumiko_csrf` (JS-readable, carries a
// token). The web client reads `kumiko_csrf` from document.cookie and
// echoes the value in an `X-CSRF-Token` header on every state-changing
// request. An attacker on bad.com cannot read the cookie (same-origin)
// and therefore cannot forge the header, so any cross-site POST from the
// attacker's page will fail the match even if the browser sent the
// cookies along (which SameSite=Lax already prevents for all methods
// other than top-level GETs — CSRF-middleware is belt-and-braces).
//
// Token rotation: issued at login + switch-tenant only, tied to the same
// lifetime as the auth-cookie. No per-request rotation — that's the
// Synchronizer Token pattern, needed only when token leakage via URL
// logs or referrers is on the threat model. We keep cookies out of URLs.
export function csrfMiddleware() {
  return async (c: Context, next: Next) => {
    // Not authenticated (public route) or bearer-only — no CSRF vector.
    const transport = getAuthTransport(c);
    if (transport !== "cookie") return next();

    // Safe method — no CSRF check. SameSite=Lax blocks cross-site
    // navigation-GETs from sending cookies, which is the only plausible
    // CSRF-via-GET vector.
    if (!STATE_CHANGING_METHODS.has(c.req.method)) return next();

    const cookieToken = getCookie(c, CSRF_COOKIE_NAME);
    const headerToken = c.req.header(CSRF_HEADER_NAME);

    // Both must exist and match byte-for-byte. A missing cookie means the
    // token was never issued (stale session or cross-origin attempt);
    // a missing header means the client didn't attach it (attacker's
    // cross-origin form submission can't read the cookie to forge one).
    if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
      return c.json(
        {
          error: {
            code: "csrf_token_mismatch",
            httpStatus: 403,
            message: "csrf token missing or mismatch",
            i18nKey: "auth.errors.csrfTokenMismatch",
          },
        },
        403,
      );
    }

    return next();
  };
}
