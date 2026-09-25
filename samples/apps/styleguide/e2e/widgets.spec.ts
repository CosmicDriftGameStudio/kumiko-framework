// Render proof for the widget kit: the catalog page mounts, all sections
// render (stats, charts, badges, ModeSwitch) and the ModeSwitch is
// interactive.

import { expect, test } from "@playwright/test";

test("widget catalog renders and ModeSwitch toggles", async ({ page }) => {
  await page.goto("/widgets");

  await expect(page.getByTestId("widgets-page")).toBeVisible();
  await expect(page.getByText("Portfolio")).toBeVisible();
  await expect(page.getByRole("img", { name: "Uptime for the last 90 days" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Response time history" })).toBeVisible();
  await expect(page.getByText("major outage")).toBeVisible();

  // Locale-aware number formatting: en locale renders the currency symbol
  // first with comma thousands separators, not the German dot/suffix
  // convention.
  await expect(page.getByText("€92,753.00")).toBeVisible();
  await expect(page.getByText("3.1%").first()).toBeVisible();

  // ModeSwitch: toggling updates aria-pressed + the DetailList value.
  const fixed = page.getByRole("button", { name: "Fixed rate" });
  await expect(fixed).toHaveAttribute("aria-pressed", "false");
  await fixed.click();
  await expect(fixed).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Fixed rate", { exact: true }).nth(1)).toBeVisible();

  // Drawer: trigger opens the sheet, title + footer close shuts it again.
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const drawer = page.getByTestId("drawer-demo");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Message")).toBeVisible();
  if (process.env["SCREENSHOT"] === "1") {
    // @template-drift-exception: #3121 ad hoc local debug dump (/tmp), not a docs-pipeline capture
    await page.screenshot({ path: "/tmp/widgets-drawer-open.png", fullPage: true });
  }
  await drawer.getByRole("button", { name: "Cancel" }).click();
  await expect(drawer).toBeHidden();

  // Drawer belowHeader (fw drawer-below-header-height): the flush panel's
  // top must sit at the ShellHeader's bottom edge and its bottom edge must
  // stay within the viewport, so the footer button is visible — not the
  // pre-fix `h-full` layout, which pushed the bottom edge past the viewport.
  await page.getByRole("button", { name: "Open below header" }).click();
  const belowHeaderDrawer = page.getByTestId("drawer-below-header-demo");
  await expect(belowHeaderDrawer).toBeVisible();
  const header = page.locator('[data-kumiko-layout="shell-header"]');
  const headerBox = await header.boundingBox();
  const panelBox = await belowHeaderDrawer.boundingBox();
  const viewport = page.viewportSize();
  if (headerBox === null || panelBox === null || viewport === null) {
    throw new Error("expected header, panel and viewport to have a bounding box");
  }
  expect(Math.abs(panelBox.y - (headerBox.y + headerBox.height))).toBeLessThan(2);
  expect(Math.abs(panelBox.y + panelBox.height - viewport.height)).toBeLessThan(2);
  await expect(belowHeaderDrawer.getByRole("button", { name: "Cancel" })).toBeInViewport();
  await belowHeaderDrawer.getByRole("button", { name: "Cancel" }).click();
  await expect(belowHeaderDrawer).toBeHidden();

  // InfinityList: first page loads, unread filter refetches to a subset.
  const inbox = page.getByTestId("inbox-demo");
  await expect(inbox.getByText("William Smith · Meeting Tomorrow").first()).toBeVisible();
  await expect(inbox.getByText("Archive").first()).toBeVisible();
  await page.getByRole("button", { name: "Unread" }).click();
  await expect(inbox.getByText("William Smith · Meeting Tomorrow").first()).toBeVisible();
  await expect(inbox.getByText("Alice Smith · Re: Project Update")).toBeHidden();

  // Search field filters server-side (sender/subject substring).
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("Bob");
  await expect(inbox.getByText("Bob Johnson · Weekend Plans").first()).toBeVisible();
  await expect(inbox.getByText("William Smith · Meeting Tomorrow")).toHaveCount(0);

  // Clicking a row shows the message in the right panel (split view).
  await expect(page.getByText("No message selected")).toBeVisible();
  await inbox
    .getByRole("button", { name: /Bob Johnson/ })
    .first()
    .click();
  await expect(page.getByText("No message selected")).toBeHidden();

  if (process.env["SCREENSHOT"] === "1") {
    // @template-drift-exception: #3121 ad hoc local debug dump (/tmp), not a docs-pipeline capture
    await page.screenshot({ path: "/tmp/widgets-catalog.png", fullPage: true });
  }
});

test("declarative dashboard screen renders stat, chart and list panels", async ({ page }) => {
  // Panel labels come from r.translations() (real i18n resolution, unlike
  // the static demo strings in the catalog above) — browser default locale
  // is en, so force de explicitly like the screenshot matrix runner does.
  await page.addInitScript(() => localStorage.setItem("kumiko:locale", "de"));
  await page.goto("/widgets-dashboard");

  await expect(page.getByTestId("dashboard-widgets-dashboard")).toBeVisible();
  // Stat panel: value + sub-line from the demo query.
  await expect(page.getByText("92.753 €")).toBeVisible();
  await expect(page.getByText("über 4 Konten")).toBeVisible();
  // Chart panel: SVG with translated aria label.
  await expect(page.getByRole("img", { name: "Antwortzeit" })).toBeVisible();
  // List panel: row from the paged envelope.
  await expect(page.getByText("API-Timeout eu-central")).toBeVisible();

  if (process.env["SCREENSHOT"] === "1") {
    // @template-drift-exception: #3121 ad hoc local debug dump (/tmp), not a docs-pipeline capture
    await page.screenshot({ path: "/tmp/widgets-dashboard.png", fullPage: true });
  }
});
