#!/usr/bin/env bun
// @runtime dev
// biome-ignore-all lint/suspicious/noConsole: CLI script
//
// Generates feature-reference + sample preview PNGs.
// Usage: bun run gen:feature-screenshots

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  getAuthDeleteAccountHtml,
  getAuthForgotPasswordHtml,
  getAuthLoginHtml,
  getAuthSignupHtml,
} from "../preview-html/auth-surfaces";
import {
  getComplianceProfilesPreviewHtml,
  getTenantPreviewHtml,
  getUserDataRightsPreviewHtml,
  getUserPreviewHtml,
  getUserProfilePreviewHtml,
} from "../preview-html/identity-gdpr";
import { getTextContentHelpHtml } from "../preview-html/text-content";
import { renderLandingPreview } from "../recipes/apex-landing/src/preview-html";
import {
  getLegalImpressumHtml,
  getLegalPrivacyHtml,
} from "../recipes/legal-pages/src/preview-html";
import { getManagedAboutHtml } from "../recipes/managed-pages/src/preview-html";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES_ROOT = resolve(HERE, "..");
const DEFAULT_OUT = resolve(
  SAMPLES_ROOT,
  "../../kumiko-platform/apps/docs/public/screenshots/features",
);

const OUT_DIR = process.env["SCREENSHOT_DIR"] ?? DEFAULT_OUT;
const APPS_OUT = `${OUT_DIR}/apps`;
const MIN_BYTES = 5 * 1024;

type HtmlShot = { readonly name: string; readonly html: string };

type AppRunner = {
  readonly id: string;
  readonly cwd: string;
  readonly command: readonly string[];
};

const APP_RUNNERS: readonly AppRunner[] = [
  {
    id: "marketing-demo",
    cwd: resolve(SAMPLES_ROOT, "apps/marketing-demo"),
    command: ["bun", "run", "screenshots"],
  },
  {
    id: "ui-walkthrough",
    cwd: resolve(SAMPLES_ROOT, "apps/ui-walkthrough"),
    command: [
      "bun",
      "x",
      "playwright",
      "test",
      "e2e/screenshots.spec.ts",
      "--config=playwright.config.ts",
    ],
  },
  {
    id: "workspaces",
    cwd: resolve(SAMPLES_ROOT, "apps/workspaces"),
    command: [
      "bun",
      "x",
      "playwright",
      "test",
      "e2e/screenshots.spec.ts",
      "--config=playwright.config.ts",
    ],
  },
];

function buildStaticShots(): readonly HtmlShot[] {
  return [
    { name: "tier-engine", html: renderLandingPreview() },
    { name: "text-content", html: getTextContentHelpHtml() },
    { name: "legal-pages", html: getLegalImpressumHtml() },
    { name: "legal-privacy", html: getLegalPrivacyHtml() },
    { name: "managed-pages", html: getManagedAboutHtml() },
    { name: "auth-login", html: getAuthLoginHtml() },
    { name: "auth-signup", html: getAuthSignupHtml() },
    { name: "auth-forgot-password", html: getAuthForgotPasswordHtml() },
    { name: "auth-delete-account", html: getAuthDeleteAccountHtml() },
    { name: "tenant", html: getTenantPreviewHtml() },
    { name: "user", html: getUserPreviewHtml() },
    { name: "user-profile", html: getUserProfilePreviewHtml() },
    { name: "compliance-profiles", html: getComplianceProfilesPreviewHtml() },
    { name: "user-data-rights", html: getUserDataRightsPreviewHtml() },
  ];
}

async function screenshotHtml(shots: readonly HtmlShot[]): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  try {
    for (const shot of shots) {
      await page.setContent(shot.html, { waitUntil: "networkidle" });
      const path = `${OUT_DIR}/${shot.name}.png`;
      await page.screenshot({ path, fullPage: true });
      const size = statSync(path).size;
      if (size < MIN_BYTES) throw new Error(`${path} too small (${size} bytes)`);
      console.log(`wrote ${path} (${size} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

function copyConfigScreenshot(): void {
  const dest = `${OUT_DIR}/config.png`;
  const candidates = [
    resolve(
      SAMPLES_ROOT,
      "../../kumiko-platform/apps/docs/public/screenshots/config-demo/config-edit-override.png",
    ),
    `${OUT_DIR}/.config-demo-tmp/config-edit-override.png`,
  ];
  for (const src of candidates) {
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`wrote ${dest} (from ${src})`);
      return;
    }
  }
  console.warn("skip config.png — no config-demo asset found");
}

function dirHasPng(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".png"));
}

function copyMarketingFallback(): void {
  const src = resolve(SAMPLES_ROOT, "../../kumiko-platform/apps/marketing/src/assets/screenshots");
  const dest = `${APPS_OUT}/marketing-demo`;
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(src)) {
    if (!name.endsWith(".png")) continue;
    copyFileSync(join(src, name), join(dest, name));
    copied++;
  }
  if (copied > 0)
    console.log(`copied ${copied} marketing-demo PNGs from kumiko-platform marketing assets`);
}

async function runAppScreenshots(): Promise<void> {
  if (process.env["SKIP_APP_SCREENSHOTS"] === "1") {
    console.log("SKIP_APP_SCREENSHOTS=1 — skipping live app captures");
    return;
  }

  for (const app of APP_RUNNERS) {
    const out = `${APPS_OUT}/${app.id}`;
    mkdirSync(out, { recursive: true });
    console.log(`\n→ ${app.id} …`);
    const proc = Bun.spawn([...app.command], {
      cwd: app.cwd,
      env: { ...process.env, SCREENSHOT_DIR: out, CI: "1" },
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      console.warn(`warn: ${app.id} screenshots failed (exit ${code}) — need .env + Postgres?`);
    }
  }
  if (!dirHasPng(`${APPS_OUT}/marketing-demo`)) {
    copyMarketingFallback();
  }
}

function listPngs(dir: string, prefix = ""): Array<{ rel: string; label: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ rel: string; label: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listPngs(full, rel));
    } else if (entry.name.endsWith(".png")) {
      out.push({ rel: `./${rel}`, label: rel.replace(/\.png$/, "").replace(/\//g, " · ") });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function writePreviewIndex(): void {
  const featurePngs = listPngs(OUT_DIR).filter((p) => !p.rel.includes("/apps/"));
  const appPngs = listPngs(APPS_OUT, "apps");

  const section = (title: string, items: Array<{ rel: string; label: string }>) =>
    items.length === 0
      ? ""
      : `<h2>${title}</h2>\n${items.map((i) => `<section><h3>${i.label}</h3><img src="${i.rel}" alt="${i.label}" style="max-width:100%;border:1px solid #ccc;border-radius:8px;" /></section>`).join("\n")}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Feature &amp; sample screenshot preview</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;}
    section{margin:1.5rem 0 2.5rem;}
    h3{font-size:1rem;color:#475067;margin-bottom:.5rem;}
  </style>
</head>
<body>
  <h1>Feature &amp; sample screenshot preview</h1>
  <p>Regenerate: <code>bun run gen:feature-screenshots</code> in kumiko-framework.</p>
  ${section("Bundled features (static render)", featurePngs)}
  ${section("Sample apps (live UI)", appPngs)}
</body>
</html>
`;
  const indexPath = `${OUT_DIR}/index.html`;
  writeFileSync(indexPath, html, "utf-8");
  console.log(`\nwrote ${indexPath} (${featurePngs.length} feature + ${appPngs.length} app PNGs)`);
}

async function main(): Promise<void> {
  console.log(`screenshot dir: ${OUT_DIR}`);

  await screenshotHtml(buildStaticShots());
  copyConfigScreenshot();
  await runAppScreenshots();
  writePreviewIndex();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
