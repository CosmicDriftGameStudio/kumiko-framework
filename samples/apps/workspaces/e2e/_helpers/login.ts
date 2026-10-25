// Login helper for the workspaces E2Es. The pattern is 1:1 as in the ui-
// walkthrough sample (see ../../../ui-walkthrough/e2e/_helpers/login.ts
// for the detailed rationale). Short form: POST directly to
// /api/auth/login, Playwright's page.request shares the cookie jar with
// the page context, a subsequent goto boots authenticated.

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
