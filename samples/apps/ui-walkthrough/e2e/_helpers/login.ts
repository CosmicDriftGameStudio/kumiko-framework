// Login helper for sample E2Es.
//
// Background: src/server.ts wires in `auth: { loginHandler, … }`, so
// no more auto-mint JWT on GET /. Tests must authenticate before the first
// `page.goto("/")` — otherwise the SessionProvider renders
// the LoginScreen instead of the app.
//
// Implementation: POST directly to /api/auth/login. Playwright's
// page.request shares the cookie jar with the page context, so
// kumiko_auth (HttpOnly JWT) and kumiko_csrf (JS-readable) land in the
// browser automatically. A subsequent goto("/") boots as the authenticated user.
//
// Deliberately NOT clicked through the login form: the auth flow itself has
// its own E2Es. Here we only want "user is in", not "login
// works".
//
// File location: local to the sample, not in bundled-features. As long as
// there is only one consumer (this sample), an early
// extraction would be a premature abstraction. Once a second sample
// needs the same logic, the function can migrate to
// `auth-email-password/testing`.

import type { Cookie, Page } from "@playwright/test";
// Straight from auth-constants — NEVER via seed.ts or bundled-features.
// Those pull in `vitest` as a transitive dep (framework/testing → vitest)
// and collide with Playwright's expect via the Object.prototype
// symbol $$jest-matchers-object.
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../src/app/auth-constants";

// The login route allows 20 requests per minute and IP. One login per user and worker keeps
// the suite under that limit; later tests get the same session cookies.
const sessionCookiesByEmail = new Map<string, readonly Cookie[]>();

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const cachedCookies = sessionCookiesByEmail.get(email);
  if (cachedCookies !== undefined) {
    await page.context().addCookies([...cachedCookies]);
    return;
  }
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  if (!res.ok()) {
    throw new Error(`loginAs: POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
  sessionCookiesByEmail.set(email, await page.context().cookies());
}

export const loginAsAdmin = (page: Page): Promise<void> =>
  loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
