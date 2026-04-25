// Login-Helper für die Workspaces-E2Es. Pattern ist 1:1 wie im ui-
// walkthrough-Sample (siehe ../../../ui-walkthrough/e2e/_helpers/login.ts
// für die ausführliche Begründung). Kurzform: POST direkt auf
// /api/auth/login, Playwrights page.request teilt das Cookie-Jar mit
// dem page-Context, anschließendes goto bootet authentifiziert.

import type { Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../src/auth-constants";

export async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`loginAsAdmin: POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
}
