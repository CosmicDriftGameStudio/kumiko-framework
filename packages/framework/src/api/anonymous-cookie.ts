// Server-side helper for the kumiko_tenant cookie used by the anonymous-
// access flow. Apps call setTenantCookie(c, tenantId) once a tenantResolver
// has determined the visitor's tenant, so subsequent requests skip the
// resolver (which usually does DB / cache lookups). deleteTenantCookie
// pairs with a switch-tenant or logout flow.
//
// The cookie is HttpOnly: the only consumer is the server-side auth-
// middleware on the next request — no client-side JS needs to read it,
// and not exposing it to JS keeps it out of XSS reach.

import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { TenantId } from "../engine/types";
import { TENANT_COOKIE_NAME } from "./api-constants";

// 30 days. The tenant assignment is stable for the lifetime of the
// visitor's relationship with the deployment — re-running the resolver
// on every visit would just hit the DB for no new information.
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Cookies marked Secure are dropped by browsers on http:// — locked off in
// dev/test so localhost works without TLS, on in prod where http would be
// a deployment bug we want to fail loud about (no cookie ⇒ resolver runs
// every request and the misconfiguration is visible in latency dashboards).
function cookieSecure(): boolean {
  return process.env["NODE_ENV"] === "production";
}

export type SetTenantCookieOptions = {
  // Override the default 30-day lifetime. Use shorter values for previews,
  // longer for stable installations.
  readonly maxAgeSeconds?: number;
  // SameSite policy. Default "Lax" matches auth-cookie behaviour and
  // permits cross-site GET-navigation (e.g. inbound link from a search
  // result lands the visitor on the right tenant via the cookie).
  readonly sameSite?: "Lax" | "Strict";
};

// Stamps the kumiko_tenant cookie on the response. Idempotent — calling it
// twice in the same request just overwrites with the latest value.
export function setTenantCookie(
  c: Context,
  tenantId: TenantId,
  options: SetTenantCookieOptions = {},
): void {
  setCookie(c, TENANT_COOKIE_NAME, tenantId, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: options.sameSite ?? "Lax",
    path: "/",
    maxAge: options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
  });
}

// Removes the kumiko_tenant cookie. Use on switch-tenant flows or when
// the resolver no longer recognises the visitor's tenant — leaving a
// stale cookie behind would keep them pointed at a deleted tenant.
export function deleteTenantCookie(c: Context): void {
  deleteCookie(c, TENANT_COOKIE_NAME, { path: "/" });
}
