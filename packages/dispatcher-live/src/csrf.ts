// CSRF-token extraction from document.cookie.
//
// Kumiko's auth-middleware sets two cookies on login (see Vorarbeit A):
//   - `kumiko_auth`  — HttpOnly, carries the JWT. Invisible to JS.
//   - `kumiko_csrf`  — JS-readable, carries a random token.
// Both carry the `__Host-` prefix when the server writes them Secure and
// without a Domain (see @cosmicdrift/kumiko-types/session-cookies).
//
// The double-submit CSRF pattern: every state-changing request echoes the
// `kumiko_csrf` value into an `X-CSRF-Token` header. Server compares header
// vs cookie in csrfMiddleware and rejects on mismatch. An attacker on a
// third-party origin can trigger a cross-site fetch (cookies fly with
// SameSite=Lax on top-level GETs, or Strict blocks them entirely) but
// cannot READ `document.cookie` of our origin — so they can't populate the
// header with the matching value.

import {
  CSRF_COOKIE_BASE,
  sessionCookieNameCandidates,
} from "@cosmicdrift/kumiko-types/session-cookies";

// Kept here as a literal rather than imported from @cosmicdrift/kumiko-framework because this
// package must remain server-dep-free (runs in browsers and React Native).
// The framework's csrf-constants-sync test guards against drift.
export const CSRF_HEADER_NAME = "X-CSRF-Token";

const CSRF_COOKIE_NAMES = sessionCookieNameCandidates(CSRF_COOKIE_BASE);

// Reads the csrf token from document.cookie. Returns undefined when:
//   - `document` isn't available (SSR, Web Worker, React Native)
//   - the cookie was never set (before login, after logout)
//
// Callers ALWAYS handle undefined — the request still goes out, the server
// rejects with csrf_token_missing and the UI surfaces an auth-expired
// toast. That's the right failure mode: silently skipping the header
// would hide a broken auth state.
export function readCsrfToken(cookieSource?: string): string | undefined {
  const raw = cookieSource ?? readDocumentCookie();
  if (!raw) return undefined;
  // cookie format: "a=1; b=2; kumiko_csrf=<uuid>; c=3"
  // Parse by splitting on "; " — cookie values never contain that
  // delimiter literally (they're percent-encoded if needed).
  const valuesByName = new Map<string, string>();
  for (const pair of raw.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq);
    if (!valuesByName.has(name)) valuesByName.set(name, pair.slice(eq + 1));
  }
  for (const name of CSRF_COOKIE_NAMES) {
    const value = valuesByName.get(name);
    if (value !== undefined) return value.length > 0 ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

function readDocumentCookie(): string | undefined {
  // Guard for non-browser environments. Avoid `typeof document` on the
  // left so a bundler that const-folds to "document is defined" still
  // compiles — the actual runtime check is what matters.
  const g = globalThis as { document?: { cookie?: string } };
  return g.document?.cookie;
}
