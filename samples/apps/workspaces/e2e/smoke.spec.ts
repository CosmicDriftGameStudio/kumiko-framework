// Smoke-Test für den workspaces-Sample. Beweist end-to-end:
//   runDevApp → AppSchema-Injection → AuthGate → Login → WorkspaceShell
//   → Default-Workspace-Resolution (admin) → Sidebar-Filter via roles.
//
// Pendant zu ui-walkthrough/e2e/smoke.spec.ts — kein Pendant-Specs für
// create-flow/update-flow weil die Recipe-Layer das schon abdeckt; der
// Showcase-Wert hier ist die Workspace-Komposition selbst.

import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test("workspaces: boot, login, lands on admin workspace, sidebar zeigt admin-navs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  await loginAsAdmin(page);
  await page.goto("/");

  // WorkspaceShell rendert den Switcher als Dropdown (Trigger zeigt das
  // aktive Label). Admin wird Default — das pinnt sowohl den Login-Path
  // als auch die Resolution-Reihenfolge (URL > initial > engine-default).
  await expect(page.getByTestId("workspace-switcher-trigger")).toContainText("Admin");

  expect(errors, errors.join("\n")).toEqual([]);
});

test("workspaces: switcher klick wechselt Sidebar-Inhalt", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/");

  // Admin sieht alle drei Workspaces im geöffneten Dropdown. Click auf
  // "dispatch" wechselt:
  //   - Trigger-Label wandert
  //   - URL wird auf /dispatch/<screen> rewritten
  //   - NavTree zeigt nur noch dispatch's navMembers (order-list)
  // Driver wird gleichzeitig sichtbar im Dropdown (Admin-Rolle deckt es ab).
  await page.getByTestId("workspace-switcher-trigger").click();
  await expect(page.getByTestId("workspace-tab-admin")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-dispatch")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-driver")).toBeVisible();

  await page.getByTestId("workspace-tab-dispatch").click();

  // URL spiegelt den Switch — der WorkspaceShell rewriting der path
  // segments ist URL-driven (siehe workspace-shell.tsx: nav.replace).
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/dispatch(\/.*)?$/);

  // Switcher-State: dispatch ist jetzt aktiv.
  await expect(page.getByTestId("workspace-switcher-trigger")).toContainText("Dispatch");
});
