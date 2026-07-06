// E2E screenshot renderer for the Apex landing example. Renders the sample page
// to HTML, paints it in a real browser and shoots a full-page PNG. The output is
// what the docs guide embeds — regenerate with `bun run screenshot`, never hand-
// captured, so it can't drift from the renderer.
//
// SCREENSHOT_DIR overrides the output dir (CI writes straight into the docs repo).

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { HERO_SCREENSHOT } from "../src/constants";
import { renderLanding, SAMPLE_PLANS } from "../src/feature";

const OUT_DIR = process.env["SCREENSHOT_DIR"] ?? resolve(import.meta.dirname, "../screenshots");
const HERO_APP_PNG = resolve(OUT_DIR, "hero-app.png");
const LANDING_PNG = resolve(OUT_DIR, "landing.png");
const LIGHTBOX_PNG = resolve(OUT_DIR, "lightbox.png");

/** Minimal in-app board mock — hero frame shows product UI, not the full landing PNG. */
const HERO_APP_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; background: #f4f4f5; font-family: system-ui, sans-serif; }
    #board {
      width: 720px; padding: 16px; background: #fff; border-radius: 12px;
      border: 1px solid #e4e4e7; box-sizing: border-box;
    }
    .top { display: flex; justify-content: space-between; margin-bottom: 16px; font-weight: 600; }
    .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .col { background: #fafafa; border-radius: 8px; padding: 10px; min-height: 140px; }
    .label { font-size: 11px; color: #71717a; margin-bottom: 8px; }
    .card {
      background: #fff; border: 1px solid #e4e4e7; border-radius: 6px;
      padding: 8px; margin-bottom: 8px; font-size: 13px;
    }
    .tag {
      display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 4px;
      background: #ede9fe; color: #5b21b6; margin-left: 4px;
    }
  </style>
</head>
<body>
  <div id="board">
    <div class="top"><span>Tasklane — Q3 roadmap</span><span style="color:#71717a;font-weight:400">3 projects</span></div>
    <div class="cols">
      <div class="col">
        <div class="label">Backlog</div>
        <div class="card">Auth hardening<span class="tag">P1</span></div>
        <div class="card">Export CSV</div>
      </div>
      <div class="col">
        <div class="label">In progress</div>
        <div class="card">Board filters</div>
        <div class="card">Invite flow</div>
      </div>
      <div class="col">
        <div class="label">Done</div>
        <div class="card">Dark mode</div>
      </div>
    </div>
  </div>
</body>
</html>`;

function heroForMount(): typeof HERO_SCREENSHOT {
  const b64 = readFileSync(HERO_APP_PNG).toString("base64");
  return { ...HERO_SCREENSHOT, src: `data:image/png;base64,${b64}` };
}

async function assertHeroImageLoaded(page: Page): Promise<void> {
  const img = page.locator(".shot-frame img");
  await expect(img).toBeVisible();
  await expect
    .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

/** setContent does not reliably fetch routed /screenshots/* — inline data: URL instead. */
async function mountLanding(page: Page): Promise<void> {
  if (!existsSync(HERO_APP_PNG)) {
    throw new Error("hero-app.png missing — run hero-app test first (serial suite)");
  }
  await page.setContent(
    renderLanding({ plans: SAMPLE_PLANS, heroScreenshot: heroForMount() }),
    { waitUntil: "networkidle", url: "http://localhost/" },
  );
  await assertHeroImageLoaded(page);
}

test.describe.configure({ mode: "serial" });

test("hero-app — product screenshot asset", async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setContent(HERO_APP_HTML, { waitUntil: "networkidle" });
  await page.locator("#board").screenshot({ path: HERO_APP_PNG });
  expect(statSync(HERO_APP_PNG).size).toBeGreaterThan(5 * 1024);
});

test("apex landing — full page", async ({ page }) => {
  await mountLanding(page);
  await page.screenshot({ path: LANDING_PNG, fullPage: true });
  expect(statSync(LANDING_PNG).size).toBeGreaterThan(5 * 1024);
});

test("apex lightbox — open (screenshot)", async ({ page }) => {
  await mountLanding(page);
  await page.locator(".shot-frame img").click();
  await expect(page.locator("#apex-lightbox")).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator("#apex-lightbox img")
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: LIGHTBOX_PNG });
  expect(statSync(LIGHTBOX_PNG).size).toBeGreaterThan(5 * 1024);
});

test("apex lightbox — closes on button", async ({ page }) => {
  await mountLanding(page);
  await page.locator(".shot-frame img").click();
  await expect(page.locator("#apex-lightbox")).toBeVisible();
  await page.locator(".apex-lightbox__close").click();
  await expect(page.locator("#apex-lightbox")).not.toBeVisible();
});
