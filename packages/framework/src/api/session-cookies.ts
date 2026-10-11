import {
  isHostPrefixedCookieName,
  resolveSessionCookieNames,
  type SessionCookieNames,
} from "@cosmicdrift/kumiko-types/session-cookies";
import type { Context, MiddlewareHandler } from "hono";

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
}): ResolvedSessionCookies {
  const secure = resolveSecureCookies(options.secureCookies);
  return { secure, names: resolveSessionCookieNames({ secure, domain: options.cookieDomain }) };
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
