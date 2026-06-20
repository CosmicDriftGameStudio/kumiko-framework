// End-to-End-Beweis für die EINE Nav (Visual-Tree-Merge): der statische
// `Content`-Knoten zieht seine Children aus einem nav-provider, das „+"
// öffnet die Create-Maske im EditorPanel, und nach dem Anlegen erscheint
// die neue Seite LIVE im Sidebar-Tree (SSE über treeEntities ["page"]) —
// ohne Reload. Genau der „Content + → pricing"-Flow.

import { expect, test } from "@playwright/test";

test("Content +: neue Seite anlegen → erscheint live im Nav-Tree", async ({ page }) => {
  await page.goto("/item-list");

  // Der statische Content-Provider-Knoten ist in der Sidebar.
  await expect(page.getByText("Content", { exact: true })).toBeVisible();

  const slug = `e2e-${Date.now()}`;
  const title = `E2E ${slug}`;

  // "+" am Content-Knoten (persistente createAction) → Create-Maske.
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.getByText("Neue Seite")).toBeVisible();

  await page.locator("#content-slug").fill(slug);
  await page.locator("#content-title").fill(title);
  await page.getByRole("button", { name: "Seite anlegen" }).click();

  // SSE-Refresh: die frisch angelegte Seite taucht im Nav-Tree auf, ohne
  // dass die Seite neu geladen wurde.
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

  // Sicht-Beleg (nicht committed): Sidebar mit Content + neu angelegter Seite.
  if (process.env["SCREENSHOT"] === "1") {
    await page.screenshot({ path: "/tmp/content-nav-demo.png" });
  }
});
