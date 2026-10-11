// Single source of the session cookie names, shared by the server and by
// browser/native clients (this package has no server dependencies).
//
// A cookie gets the `__Host-` prefix exactly when it is written Secure and
// without a Domain attribute: the browser then refuses any Set-Cookie for that
// name that is not Secure, Path=/ and host-only, so a sibling subdomain cannot
// set or shadow it.

export const AUTH_COOKIE_BASE = "kumiko_auth";
export const CSRF_COOKIE_BASE = "kumiko_csrf";
export const TENANT_COOKIE_BASE = "kumiko_tenant";

export const HOST_COOKIE_PREFIX = "__Host-";

export type SessionCookieBase =
  | typeof AUTH_COOKIE_BASE
  | typeof CSRF_COOKIE_BASE
  | typeof TENANT_COOKIE_BASE;

export type SessionCookieNames = {
  readonly auth: string;
  readonly csrf: string;
  readonly tenant: string;
};

export function sessionCookieName(
  base: SessionCookieBase,
  options: { readonly secure: boolean; readonly domain?: string | undefined },
): string {
  return options.secure && options.domain === undefined ? `${HOST_COOKIE_PREFIX}${base}` : base;
}

export function isHostPrefixedCookieName(name: string): boolean {
  return name.startsWith(HOST_COOKIE_PREFIX);
}

// The tenant cookie is always host-only, so a cookieDomain only affects the
// auth and csrf names.
export function resolveSessionCookieNames(options: {
  readonly secure: boolean;
  readonly domain?: string | undefined;
}): SessionCookieNames {
  return {
    auth: sessionCookieName(AUTH_COOKIE_BASE, options),
    csrf: sessionCookieName(CSRF_COOKIE_BASE, options),
    tenant: sessionCookieName(TENANT_COOKIE_BASE, { secure: options.secure }),
  };
}

// Browser-side candidates, preferred first. The client cannot know the server
// config; when both cookies exist the prefixed one is the trustworthy one.
export function sessionCookieNameCandidates(base: SessionCookieBase): readonly string[] {
  return [sessionCookieName(base, { secure: true }), sessionCookieName(base, { secure: false })];
}
