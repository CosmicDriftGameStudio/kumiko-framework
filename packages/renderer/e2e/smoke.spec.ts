// Smoke test for the renderer/e2e setup. Proves three things:
//
//   1. The bundle builds without errors (Bun.build sees all imports resolve)
//   2. createKumikoApp mounts in the browser without console errors
//   3. DefaultAppShell renders brand + NavTree + first screen
//
// If this is on fire, the cause is the mount path — not a single
// component. More specific specs (primitives, layout) add on from
// here without this test having to be touched.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test("renderer/e2e: bundle bootet, DefaultAppShell rendert NavTree + Edit-Form", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  await page.goto("/");

  // The brand sits in the sidebar header — proves that DefaultAppShell renders with
  // the hand-passed schema (no server inject).
  await expect(page.getByText("Renderer-Web E2E")).toBeVisible();

  // NavTree shows the navs from the test schema. "Things" + "New Thing"
  // are declared explicitly in fixtures/schema.ts; if the schema
  // does not reach the renderer, the strings would not be there.
  await expect(page.getByText("Things")).toBeVisible();
  await expect(page.getByText("New Thing")).toBeVisible();

  // Erstes Screen ist `thing-edit` (Position 0 in screens-Array) —
  // KumikoScreen rendert die Edit-Form mit dem entityEdit-testId-Slot.
  await expect(page.getByTestId("render-edit-form")).toBeVisible();

  expect(errors, errors.join("\n")).toEqual([]);
});
