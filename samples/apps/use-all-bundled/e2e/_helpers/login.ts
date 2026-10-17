// Login-Helper für die Screenshot-E2Es. POST direkt gegen /api/auth/login;
// Playwrights page.request teilt das Cookie-Jar mit dem page-Context, also
// landen kumiko_auth + kumiko_csrf automatisch im Browser und das folgende
// goto() bootet authentifiziert. Import direkt aus auth-constants (framework-
// frei) — NIE über seed/bundled-features, die ziehen vitest transitiv mit.

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
