// Smoke-Test fürs renderer-web/e2e-Setup. Beweist drei Sachen:
//
//   1. Bundle baut ohne Fehler (Bun.build sieht alle Imports auflösen)
//   2. createKumikoApp mountet im Browser ohne Console-Errors
//   3. DefaultAppShell rendert Brand + NavTree + erstes Screen
//
// Wenn das brennt, liegt's am Mount-Pfad — nicht an einer einzelnen
// Komponente. Spezifischere Specs (primitives, layout) ergänzen ab
// hier ohne dass dieser Test angefasst werden muss.

import { expect, test } from "@playwright/test";

test("renderer-web/e2e: bundle bootet, DefaultAppShell rendert NavTree + Edit-Form", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  await page.goto("/");

  // Brand sitzt links in der Topbar — beweist dass DefaultAppShell mit
  // dem hand-übergebenen schema rendert (kein Server-Inject).
  await expect(page.getByText("Renderer-Web E2E")).toBeVisible();

  // NavTree zeigt die navs aus dem Test-Schema. "Things" + "New Thing"
  // sind explizit in fixtures/schema.ts deklariert; wenn das Schema
  // nicht beim Renderer ankommt, wären die Strings nicht da.
  await expect(page.getByText("Things")).toBeVisible();
  await expect(page.getByText("New Thing")).toBeVisible();

  // Erstes Screen ist `thing-edit` (Position 0 in screens-Array) —
  // KumikoScreen rendert die Edit-Form mit dem entityEdit-testId-Slot.
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
