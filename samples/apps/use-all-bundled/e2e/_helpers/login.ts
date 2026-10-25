// Login helper for the screenshot E2Es. POST directly to /api/auth/login;
// Playwright's page.request shares the cookie jar with the page context, so
// kumiko_auth + kumiko_csrf land in the browser automatically and the following
// goto() boots authenticated. Import straight from auth-constants (framework-
// free) — NEVER via seed/bundled-features, they pull in vitest transitively.

import type { Cookie, Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../src/app/auth-constants";

// The login route allows 20 requests per minute and IP, and all specs share the IP. One login
// per worker keeps the suite under that limit; later calls reuse the session cookies.
let adminSessionCookies: readonly Cookie[] | undefined;

export async function loginAsAdmin(page: Page): Promise<void> {
  if (adminSessionCookies !== undefined) {
    await page.context().addCookies([...adminSessionCookies]);
    return;
  }
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`loginAsAdmin: POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
  adminSessionCookies = await page.context().cookies();
}
