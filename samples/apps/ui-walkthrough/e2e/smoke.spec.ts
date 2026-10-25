// Hand-written smoke run-through. Proves end to end that the
// Kumiko stack arrives in the browser:
//   createKumikoServer → Bun.build(client.tsx) → HTTP+JWT cookie
//   → createKumikoApp → PrimitivesProvider → RoutedScreen → DefaultForm
//
// Deliberately minimal — we check rendering + clean startup, no
// business logic. Create/update come in separate specs.
//
// The editor screen is the landing route because clientSchema.screens
// begins with editScreen (see samples/ui-walkthrough/src/feature-schema.ts).

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
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
