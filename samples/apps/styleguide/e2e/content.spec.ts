// End-to-end proof for the ONE nav (visual-tree merge): the static
// `Content` node pulls its children from a nav provider, the "+"
// opens the create form in the EditorPanel, and after creating, the
// new page appears LIVE in the sidebar tree (SSE via treeEntities ["page"]) —
// without a reload. Exactly the "Content + → pricing" flow.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test("Content +: create a new page → appears live in the Nav-Tree", async ({ page }) => {
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

  // Visual proof (not committed): sidebar with Content + newly created page.
  if (process.env["SCREENSHOT"] === "1") {
    // @template-drift-exception: #3121 ad hoc local debug dump (/tmp), not a docs-pipeline capture
    await page.screenshot({ path: "/tmp/content-nav-demo.png" });
  }
});
