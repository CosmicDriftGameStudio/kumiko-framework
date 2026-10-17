import {
  AUTH_COOKIE_BASE,
  CSRF_COOKIE_BASE,
  isHostPrefixedCookieName,
  resolveSessionCookieNames,
  type SessionCookieNames,
  sessionCookieName,
} from "@cosmicdrift/kumiko-types/session-cookies";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie } from "hono/cookie";

export {
  AUTH_COOKIE_BASE,
  CSRF_COOKIE_BASE,
  HOST_COOKIE_PREFIX,
  isHostPrefixedCookieName,
  resolveSessionCookieNames,
  type SessionCookieBase,
  type SessionCookieNames,
  sessionCookieName,
  TENANT_COOKIE_BASE,
} from "@cosmicdrift/kumiko-types/session-cookies";

const SESSION_COOKIES_KEY = "sessionCookies";

export type ResolvedSessionCookies = {
  readonly secure: boolean;
  readonly names: SessionCookieNames;
  readonly domain?: string | undefined;
  readonly retiredDomains?: readonly string[] | undefined;
};

// Browsers drop Secure cookies on http, so Secure is off outside production
// (Playwright against http://localhost) and on in production, where a
// misconfigured http deploy breaks login loudly instead of silently.
export function resolveSecureCookies(configured?: boolean): boolean {
  return configured ?? process.env["NODE_ENV"] === "production";
}

export function resolveSessionCookies(options: {
  readonly secureCookies?: boolean | undefined;
  readonly cookieDomain?: string | undefined;
  readonly retiredCookieDomains?: readonly string[] | undefined;
}): ResolvedSessionCookies {
  const secure = resolveSecureCookies(options.secureCookies);
  return {
    secure,
    names: resolveSessionCookieNames({ secure, domain: options.cookieDomain }),
    domain: options.cookieDomain,
    retiredDomains: options.retiredCookieDomains,
  };
}

export function sessionCookiesMiddleware(resolved: ResolvedSessionCookies): MiddlewareHandler {
  return async (c, next) => {
    c.set(SESSION_COOKIES_KEY, resolved);
    await next();
  };
}

function isResolvedSessionCookies(value: unknown): value is ResolvedSessionCookies {
  return typeof value === "object" && value !== null && "names" in value && "secure" in value;
}

// buildServer resolves the names once and stores them per request, so writer
// (auth routes) and readers (auth/csrf/tenant) cannot diverge. The fallback
// only applies to contexts that never ran through buildServer, e.g. a bare
// Hono app in a unit test or a standalone createAuthRoutes mount.
export function getSessionCookies(
  c: Context,
  fallback?: ResolvedSessionCookies,
): ResolvedSessionCookies {
  const stored: unknown = c.get(SESSION_COOKIES_KEY);
  if (isResolvedSessionCookies(stored)) return stored;
  return fallback ?? resolveSessionCookies({});
}

// A deletion of a `__Host-` cookie is ignored by the browser unless it is
// itself Secure, Path=/ and Domain-less.
export function hostOnlyDeleteOptions(name: string): { path: "/"; secure?: true } {
  return isHostPrefixedCookieName(name) ? { path: "/", secure: true } : { path: "/" };
}

// Expires the name variant the current config does not write, in both
// directions: unprefixed leftovers when names are `__Host-` prefixed, and the
// `__Host-` cookies when a later cookieDomain or secureCookies:false resolves
// to unprefixed names. Browsers prefer the prefixed csrf cookie when reading
// the token, so a leftover one would 403 every write until it expires.
export function expireLegacySessionCookieVariants(
  c: Context,
  cookies: ResolvedSessionCookies,
): void {
  if (isHostPrefixedCookieName(cookies.names.auth)) {
    deleteCookie(c, AUTH_COOKIE_BASE, { path: "/" });
    deleteCookie(c, CSRF_COOKIE_BASE, { path: "/" });
    // skip: the unprefixed names are the only legacy variant when the config writes __Host- names.
    return;
  }
  if (cookies.secure) {
    deleteCookie(c, sessionCookieName(AUTH_COOKIE_BASE, { secure: true }), hostPrefixedDelete);
    deleteCookie(c, sessionCookieName(CSRF_COOKIE_BASE, { secure: true }), hostPrefixedDelete);
  }
}

const hostPrefixedDelete = { path: "/", secure: true } as const;

// Expire every variant: the Domain cookie (current) and the host-only one
// (from before cookieDomain), otherwise a cookie left over from an earlier
// config keeps the session alive after logout. With __Host- names the
// unprefixed leftovers from before the prefix are expired as well. Retired
// domains only ever carried unprefixed names.
export function clearSessionCookies(c: Context, cookies: ResolvedSessionCookies): void {
  const { names, domain } = cookies;
  deleteCookie(c, names.auth, hostOnlyDeleteOptions(names.auth));
  deleteCookie(c, names.csrf, hostOnlyDeleteOptions(names.csrf));
  expireLegacySessionCookieVariants(c, cookies);
  if (domain !== undefined) {
    deleteCookie(c, AUTH_COOKIE_BASE, { path: "/", domain });
    deleteCookie(c, CSRF_COOKIE_BASE, { path: "/", domain });
  }
  for (const retiredDomain of cookies.retiredDomains ?? []) {
    deleteCookie(c, AUTH_COOKIE_BASE, { path: "/", domain: retiredDomain });
    deleteCookie(c, CSRF_COOKIE_BASE, { path: "/", domain: retiredDomain });
  }
}

function cookieNameOccurrences(cookieHeader: string, name: string): number {
  let count = 0;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    const pairName = (separator === -1 ? pair : pair.slice(0, separator)).trim();
    if (pairName === name) count++;
  }
  return count;
}

// Two cookies with the same name (e.g. a host-only and a Domain variant, or one
// planted by a sibling subdomain) are indistinguishable server-side; Hono's
// getCookie would silently bind to whichever the browser sent first.
export function hasDuplicateSessionCookie(c: Context, names: SessionCookieNames): boolean {
  const cookieHeader = c.req.header("cookie");
  if (cookieHeader === undefined) return false;
  return (
    cookieNameOccurrences(cookieHeader, names.auth) > 1 ||
    cookieNameOccurrences(cookieHeader, names.csrf) > 1
  );
}
