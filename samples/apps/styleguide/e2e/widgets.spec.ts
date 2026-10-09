// Render proof for the widget kit: the catalog page mounts, all sections
// render (stats, charts, badges, ModeSwitch) and the ModeSwitch is
// interactive.

import { expect, test } from "@playwright/test";

test("FloatingPanel moves, resizes, keeps the page usable and restores geometry", async ({
  page,
}) => {
  const shotDir = process.env["SCREENSHOT_DIR"];
  await page.goto("/widgets");
  await page.getByRole("button", { name: "Open panel" }).click();
  const panel = page.getByTestId("floating-panel-demo");
  await expect(panel).toBeVisible();
  if (shotDir) {
    // @template-drift-exception: #3372 ad hoc local debug dump, not a docs-pipeline capture
    await page.screenshot({ path: `${shotDir}/floating-panel-default.png` });
  }

  const before = await panel.boundingBox();
  if (before === null) throw new Error("expected the panel to have a bounding box");

  // Header drag: grab the title text, move by a known delta.
  const title = panel.getByText("Floating panel", { exact: true });
  const titleBox = await title.boundingBox();
  if (titleBox === null) throw new Error("expected the title to have a bounding box");
  const grabX = titleBox.x + 4;
  const grabY = titleBox.y + titleBox.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX - 60, grabY - 40, { steps: 5 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  if (moved === null) throw new Error("expected the moved panel to have a bounding box");
  expect(Math.round(moved.x - before.x)).toBe(-60);
  expect(Math.round(moved.y - before.y)).toBe(-40);

  // Bottom-right corner handle grows the panel.
  const cornerBox = await panel
    .locator('[aria-hidden="true"].cursor-nwse-resize')
    .last()
    .boundingBox();
  if (cornerBox === null) throw new Error("expected the corner handle to have a bounding box");
  const cornerX = cornerBox.x + cornerBox.width / 2;
  const cornerY = cornerBox.y + cornerBox.height / 2;
  await page.mouse.move(cornerX, cornerY);
  await page.mouse.down();
  await page.mouse.move(cornerX + 40, cornerY + 30, { steps: 5 });
  await page.mouse.up();
  const resized = await panel.boundingBox();
  if (resized === null) throw new Error("expected the resized panel to have a bounding box");
  expect(resized.width).toBeGreaterThan(moved.width);
  expect(resized.height).toBeGreaterThan(moved.height);
  if (shotDir) {
    // @template-drift-exception: #3372 ad hoc local debug dump, not a docs-pipeline capture
    await page.screenshot({ path: `${shotDir}/floating-panel-moved-resized.png` });
  }

  // Non-modal: the page behind still takes clicks.
  const fixed = page.getByRole("button", { name: "Fixed rate" });
  await expect(fixed).toHaveAttribute("aria-pressed", "false");
  await fixed.click();
  await expect(fixed).toHaveAttribute("aria-pressed", "true");

  // Geometry survives a reload (reopen, since open state is component state).
  await page.reload();
  await page.getByRole("button", { name: "Open panel" }).click();
  const restored = await panel.boundingBox();
  if (restored === null) throw new Error("expected the restored panel to have a bounding box");
  expect(Math.round(restored.x)).toBe(Math.round(resized.x));
  expect(Math.round(restored.width)).toBe(Math.round(resized.width));
  expect(Math.round(restored.height)).toBe(Math.round(resized.height));

  // Narrow viewport: the panel becomes a full-screen sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box === null ? null : [box.x, box.y, box.width, box.height];
    })
    .toEqual([0, 0, 390, 844]);
  if (shotDir) {
    // @template-drift-exception: #3372 ad hoc local debug dump, not a docs-pipeline capture
    await page.screenshot({ path: `${shotDir}/floating-panel-narrow.png` });
  }
});

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
  await page.getByTestId("drawer-below-header-open").click();
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
  // Stacked-area panel: range switch and brush from the panel config.
  await expect(page.getByRole("img", { name: "Anfragen pro Woche" })).toBeVisible();
  await expect(page.getByTestId("dashboard-chart-range-traffic")).toBeVisible();
  await expect(page.getByText("3 Monate")).toBeVisible();
  // List panel: row from the paged envelope.
  await expect(page.getByText("API-Timeout eu-central")).toBeVisible();

  if (process.env["SCREENSHOT"] === "1") {
    // @template-drift-exception: #3121 ad hoc local debug dump (/tmp), not a docs-pipeline capture
    await page.screenshot({ path: "/tmp/widgets-dashboard.png", fullPage: true });
  }
});
