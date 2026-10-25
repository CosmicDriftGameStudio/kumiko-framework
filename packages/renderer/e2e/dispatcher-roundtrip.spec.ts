// Dispatcher round trip: type into the edit form, submit → MockDispatcher
// writes in memory → renderer navigates to the list → row shows up.
//
// Proves the contract between renderer/web (createKumikoApp + form
// controller + list view) and a dispatcher that fulfills the write/query
// interface. When the sample E2Es are on fire it is often DB/auth —
// this test isolates on the renderer layer.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test("submit-flow: Form submit → Dispatcher.write → List refresh shows new entry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  const label = `E2E Roundtrip ${Date.now()}`;

  await page.goto("/");
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  // Tippe in Title-Feld. DefaultInput rendert ein <input> innerhalb
  // des field-<name> Wrappers — gleicher Pattern wie ui-walkthrough's
  // create-flow-Spec.
  await page.getByTestId("field-label").locator("input").fill(label);
  await page.getByTestId("render-edit-submit").click();

  // useNavigateToListAfter in KumikoScreen routes to the list
  // screen after success. We wait for the table instead of a URL change.
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  // Row lookup via the label cell. MockDispatcher stored the row in
  // tables.set("thing", ...); query "test:query:thing:list"
  // returned it.
  const labelCell = page.locator('[data-testid^="cell-"][data-testid$="-label"]', {
    hasText: label,
  });
  await expect(labelCell).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
