// Role-gating E2E for admin-console — separate seeded users per role.
// Complements security.integration tests (HTTP 403 matrix) with workspace
// switcher + overview + members UI checks.

import { expect, test } from "@playwright/test";
import {
  csrfToken,
  loginAsRegularUser,
  loginAsSysadmin,
  loginAsTenantAdmin,
} from "./_helpers/login";

test.describe("TenantAdmin workspace gating", () => {
  test("lands on tenant overview; platform workspace hidden", async ({ page }) => {
    await loginAsTenantAdmin(page);
    await page.goto("/");

    // Single visible workspace → WorkspaceSwitcher renders nothing (no tab row).
    await expect(page).toHaveURL(/\/tenant-admin\//);
    await expect(page.getByTestId("tenant-overview-screen")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-platform")).toHaveCount(0);
  });

  test("can open members; invite role picker is closed allowlist", async ({ page }) => {
    await loginAsTenantAdmin(page);
    await page.goto("/tenant-admin/members");

    await expect(page.getByTestId("members-screen")).toBeVisible();
    await page.getByTestId("combobox-invite-role").click();
    const options = page.getByRole("option");
    await expect(options.filter({ hasText: "User" })).toBeVisible();
    await expect(options.filter({ hasText: "Admin" })).toBeVisible();
    await expect(options.filter({ hasText: "Editor" })).toBeVisible();
    await expect(options.filter({ hasText: "SystemAdmin" })).toHaveCount(0);
  });

  test("API rejects platform tenant:list for TenantAdmin (403)", async ({ page }) => {
    await loginAsTenantAdmin(page);
    await page.goto("/");

    const res = await page.request.post("/api/query", {
      data: { type: "tenant:query:list", payload: {} },
      headers: { "X-CSRF-Token": await csrfToken(page) },
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("access_denied");
  });
});

test.describe("SystemAdmin workspace gating", () => {
  test("sees tenant and platform workspaces", async ({ page }) => {
    await loginAsSysadmin(page);
    await page.goto("/");

    await expect(page.getByTestId("workspace-tab-tenant-admin")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-platform")).toBeVisible();
  });

  test("switching to platform shows platform overview", async ({ page }) => {
    await loginAsSysadmin(page);
    await page.goto("/");

    await page.getByTestId("workspace-tab-platform").click();
    await expect(page).toHaveURL(/\/platform\//);
    await expect(page.getByTestId("platform-overview-screen")).toBeVisible();
  });
});

test.describe("Regular user denied admin workspaces", () => {
  test("no workspace tabs in switcher", async ({ page }) => {
    await loginAsRegularUser(page);
    await page.goto("/");

    await expect(page.getByTestId("workspace-tab-tenant-admin")).toHaveCount(0);
    await expect(page.getByTestId("workspace-tab-platform")).toHaveCount(0);
    await expect(page.getByTestId("members-screen")).toHaveCount(0);
  });
});
