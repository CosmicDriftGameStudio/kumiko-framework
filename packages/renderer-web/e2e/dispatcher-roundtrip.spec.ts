// Dispatcher-Round-Trip: tippe in Edit-Form, submit → MockDispatcher
// schreibt In-Memory → Renderer navigiert zur List → Row taucht auf.
//
// Beweist den Vertrag zwischen renderer-web (createKumikoApp + Form-
// Controller + List-View) und einem Dispatcher der das write/query-
// Interface erfüllt. Wenn die Sample-E2Es brennen ist's oft DB/Auth —
// dieser Test isoliert auf den Renderer-Layer.

import { expect, test } from "@playwright/test";

test("submit-flow: Form-Submit → Dispatcher.write → List-Refresh zeigt neuen Eintrag", async ({
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

  // useNavigateToListAfter im KumikoScreen routed nach Erfolg auf den
  // List-Screen. Wir warten auf die Tabelle statt auf eine URL-Änderung.
  await expect(page.getByTestId("render-list-table")).toBeVisible();

  // Row-Lookup über die label-Zelle. MockDispatcher hat die Row in
  // tables.set("thing", ...) gespeichert; query "test:query:thing:list"
  // lieferte sie zurück.
  const labelCell = page.locator('[data-testid^="cell-"][data-testid$="-label"]', {
    hasText: label,
  });
  await expect(labelCell).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
