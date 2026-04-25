// Handgeschriebener Smoke-Durchstich. Beweist end-to-end dass der
// Kumiko-Stack im Browser ankommt:
//   createKumikoServer → Bun.build(client.tsx) → HTTP+JWT-Cookie
//   → createKumikoApp → PrimitivesProvider → RoutedScreen → DefaultForm
//
// Bewusst minimal — wir prüfen Rendering + sauberen Start, keine
// Business-Logik. Create/Update kommen in separaten Specs.
//
// Der Editor-Screen ist die Landing-Route, weil clientSchema.screens
// mit editScreen beginnt (siehe samples/ui-walkthrough/src/feature-schema.ts).

import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./_helpers/login";

test("ui-walkthrough boots and lands on edit screen without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  await loginAsAdmin(page);
  await page.goto("/");

  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
