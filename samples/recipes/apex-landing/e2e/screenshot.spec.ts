// E2E screenshot renderer for the Apex landing example. Renders the sample page
// to HTML, paints it in a real browser and shoots a full-page PNG. The output is
// what the docs guide embeds — regenerate with `bun run screenshot`, never hand-
// captured, so it can't drift from the renderer.
//
// SCREENSHOT_DIR overrides the output dir (CI writes straight into the docs repo).

import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { renderLanding, SAMPLE_PLANS } from "../src/feature";

const OUT_DIR = process.env["SCREENSHOT_DIR"] ?? resolve(import.meta.dirname, "../screenshots");

test("apex landing — full page", async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setContent(renderLanding({ plans: SAMPLE_PLANS }), { waitUntil: "networkidle" });
  const path = `${OUT_DIR}/landing.png`;
  await page.screenshot({ path, fullPage: true });
  expect(statSync(path).size).toBeGreaterThan(5 * 1024);
});
