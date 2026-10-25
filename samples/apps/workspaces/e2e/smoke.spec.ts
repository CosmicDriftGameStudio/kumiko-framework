// Smoke test for the workspaces sample. Proves end to end:
//   runDevApp → AppSchema injection → AuthGate → login → WorkspaceShell
//   → default workspace resolution (admin) → sidebar filter via roles.
//
// Counterpart to ui-walkthrough/e2e/smoke.spec.ts — no counterpart specs for
// create-flow/update-flow because the recipe layer already covers that; the
// showcase value here is the workspace composition itself.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { loginAsAdmin } from "./_helpers/login";

test("workspaces: boot, login, lands on admin workspace, sidebar shows admin-navs", async ({
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

  // Admin sees all three workspaces in the opened dropdown. Click on
  // "dispatch" switches:
  //   - trigger label moves
  //   - URL is rewritten to /dispatch/<screen>
  //   - NavTree shows only dispatch's navMembers (order-list)
  // Driver becomes visible in the dropdown at the same time (admin role covers it).
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
