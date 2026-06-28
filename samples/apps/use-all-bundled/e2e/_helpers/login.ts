// Login-Helper für die Screenshot-E2Es. POST direkt gegen /api/auth/login;
// Playwrights page.request teilt das Cookie-Jar mit dem page-Context, also
// landen kumiko_auth + kumiko_csrf automatisch im Browser und das folgende
// goto() bootet authentifiziert. Import direkt aus auth-constants (framework-
// frei) — NIE über seed/bundled-features, die ziehen vitest transitiv mit.

import type { Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../src/app/auth-constants";

export async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`loginAsAdmin: POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
}
