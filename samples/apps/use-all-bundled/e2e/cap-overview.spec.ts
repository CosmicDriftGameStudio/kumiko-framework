// @runtime test
// Assert-E2E for cap-overview (Part B of the admin-shell nav rollout):
// SystemAdmin's tenant-cap-list (tier column + usage bar, search AND tier
// facet both narrow), row-click deep-link into platform-tenant-caps with a
// pre-selected tenant, and the TenantAdmin-facing my-caps dashboard
// resolving the same tenant's own numbers — with both the warn and danger
// tone states visible (seed.ts pushes usage past those thresholds). Mirrors
// mfa-login.spec.ts's real expect()-driven style — screenshots.spec.ts's
// runMatrix is for the docs media pipeline, not functional proof.
//
// Screenshots are local-only evidence, gitignored under test-results/ and
// skipped in CI (see `if (!process.env["CI"])` below) — same reasoning as
// screenshots.spec.ts writing outside the repo, just guarded instead of
// relying on the resolved path not existing.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { DEV_TENANT_ID } from "../src/app/auth-constants";
import { loginAsAdmin } from "./_helpers/login";

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../test-results/cap-overview");

async function shot(page: Page, name: string): Promise<void> {
  if (process.env["CI"]) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

test("SystemAdmin: tenant-cap-list search narrows, row click deep-links with the tenant preselected", async ({
  page,
}) => {
  await loginAsAdmin(page);

  // Nav wiring from admin-shell's includeCapOverview:true (run-config.ts) —
  // proves the Part-A nav entry actually resolves to a real, clickable link
  // before falling back to direct navigation for the rest of the flow.
  await page.goto("/platform");
  const tenantCapsLink = page.getByRole("link", { name: "Plans & Caps" });
  await expect(tenantCapsLink).toBeVisible();
  await expect(tenantCapsLink).toHaveAttribute("href", /tenant-cap-list/);
  await tenantCapsLink.click();

  const table = page.getByTestId("render-list-table");
  await expect(table).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Tier" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Billing" })).toBeVisible();
  await expect(page.getByTestId("cap-usage-bar").first()).toBeVisible();

  const devRow = page.getByRole("row", { name: /Dev Tenant/ });
  const betaRow = page.getByRole("row", { name: /Beta Tenant/ });
  await expect(devRow).toBeVisible();
  await expect(betaRow).toBeVisible();

  // Tier column actually shows a tier per tenant (seed.ts assigns distinct
  // tiers) — not the blank "—" a tenant with no assignment renders.
  await expect(devRow).toContainText("free");
  await expect(betaRow).toContainText("pro");

  await shot(page, "tenant-cap-list");

  // Search narrows: "Beta" matches only the Beta Tenant row.
  await page.locator("#render-list-search").fill("Beta");
  await expect(betaRow).toBeVisible();
  await expect(devRow).not.toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(1);

  // Reset search, then filter by the tier facet — same row-count-shrinks
  // proof as search, for the other filter axis the requirement calls out.
  await page.locator("#render-list-search").fill("");
  await expect(devRow).toBeVisible();
  await expect(betaRow).toBeVisible();

  await page.getByTestId("facet-tier").click();
  await page.getByTestId("facet-tier-free").click();
  await page.keyboard.press("Escape");
  await expect(devRow).toBeVisible();
  await expect(betaRow).not.toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(1);

  await devRow.click();

  await expect(page).toHaveURL(
    new RegExp(`/platform/platform-tenant-caps\\?tenantId=${DEV_TENANT_ID}`),
  );
  const dashboardCards = page.getByTestId("cap-cards-panel");
  await expect(dashboardCards).toBeVisible();
  await expect(page.getByTestId("cap-card")).toHaveCount(2); // notes + tags (cap-overview-caps.ts)
  await expect(dashboardCards).toContainText("Notes");
  await expect(dashboardCards).toContainText("Tags");
  // seed.ts pushes notes to 12/10 (danger, >=100%) and tags sits at the
  // free-tier limit of 4/5 (warn, >=80%) — both tone states visible at once.
  await expect(dashboardCards).toContainText("120%");
  await expect(dashboardCards).toContainText("80%");

  // Regression guard for the grid-track-width bug: an arbitrary Tailwind
  // bracket class on cap-cards-panel.tsx's grid never compiled (bundled-
  // features/src isn't in styles.css's @source scan), so the grid fell
  // back to one implicit column and both cards stacked full-width. Measure
  // the real rendered boxes instead of trusting the className.
  const cards = page.getByTestId("cap-card");
  const firstCardBox = await cards.nth(0).boundingBox();
  const secondCardBox = await cards.nth(1).boundingBox();
  if (firstCardBox === null || secondCardBox === null) {
    throw new Error("cap-card boundingBox() returned null — card not visible/rendered");
  }
  console.log(`cap-card widths: ${firstCardBox.width}px / ${secondCardBox.width}px`);
  expect(firstCardBox.y).toBe(secondCardBox.y);
  expect(firstCardBox.x).not.toBe(secondCardBox.x);
  expect(firstCardBox.width).toBeLessThan(400);

  const deepLinkedCardsText = await dashboardCards.innerText();

  await shot(page, "platform-tenant-caps");

  // TenantAdmin-facing dashboard (same admin also holds TenantAdmin on Dev
  // Tenant via server.ts memberships) resolves its own tenant with no
  // tenantId param — must show the SAME Dev Tenant numbers just deep-linked to.
  await page.goto("/tenant-admin/my-caps");
  const myCapsCards = page.getByTestId("cap-cards-panel");
  await expect(myCapsCards).toBeVisible();
  await expect(page.getByTestId("cap-card")).toHaveCount(2);
  // toHaveText() normalizes only the actual side, not a plain-string
  // expected — compare raw innerText on both sides instead.
  await expect(async () => {
    expect(await myCapsCards.innerText()).toBe(deepLinkedCardsText);
  }).toPass();

  await shot(page, "my-caps");
});
