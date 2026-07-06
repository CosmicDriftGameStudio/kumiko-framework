import type { Page } from "@playwright/test";
import {
  REGULAR_USER_EMAIL,
  REGULAR_USER_PASSWORD,
  SYSADMIN_EMAIL,
  SYSADMIN_PASSWORD,
  TENANT_ADMIN_EMAIL,
  TENANT_ADMIN_PASSWORD,
} from "../../src/app/auth-constants";

async function login(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`login(${email}): POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
}

export async function loginAsTenantAdmin(page: Page): Promise<void> {
  await login(page, TENANT_ADMIN_EMAIL, TENANT_ADMIN_PASSWORD);
}

export async function loginAsSysadmin(page: Page): Promise<void> {
  await login(page, SYSADMIN_EMAIL, SYSADMIN_PASSWORD);
}

export async function loginAsRegularUser(page: Page): Promise<void> {
  await login(page, REGULAR_USER_EMAIL, REGULAR_USER_PASSWORD);
}

export async function csrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === "kumiko_csrf")?.value;
  if (!csrf) throw new Error("no kumiko_csrf cookie after login");
  return csrf;
}
