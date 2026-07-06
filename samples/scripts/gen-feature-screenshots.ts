#!/usr/bin/env bun
// @runtime dev
// biome-ignore-all lint/suspicious/noConsole: CLI script
//
// Generates feature-reference + sample preview PNGs.
// Usage: bun run gen:feature-screenshots
//
// One ordered runner list: use-all-bundled (feature matrix) → recipes → sample
// apps. Each entry spawns Playwright in its cwd with SCREENSHOT_DIR=<out>.
//
// Requires Postgres + Redis + a samples .env for app runners; apex-landing uses
// setContent only. Set SKIP_APP_SCREENSHOTS=1 to skip live captures (syncs
// committed hero-app.png into showcase public/ only).

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncLightboxAssets } from "./sync-lightbox-assets.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES_ROOT = resolve(HERE, "..");
const DEFAULT_OUT = resolve(
  SAMPLES_ROOT,
  "../../kumiko-platform/apps/docs/public/screenshots/features",
);

const OUT_DIR = process.env["SCREENSHOT_DIR"] ?? DEFAULT_OUT;
const APPS_OUT = `${OUT_DIR}/apps`;

type Runner = {
  readonly id: string;
  readonly cwd: string;
  readonly command: readonly string[];
  readonly out: string;
  /** Fail the whole script when this runner exits non-zero. */
  readonly required?: boolean;
  /** Runs after a successful spawn (e.g. copy recipe assets into an app). */
  readonly after?: () => void;
};

const SCREENSHOTS_CMD = [
  "bun",
  "x",
  "playwright",
  "test",
  "e2e/screenshots.spec.ts",
  "--config=playwright.config.ts",
] as const;

const SCREENSHOT_RUNNERS: readonly Runner[] = [
  {
    id: "use-all-bundled",
    cwd: resolve(SAMPLES_ROOT, "apps/use-all-bundled"),
    command: SCREENSHOTS_CMD,
    out: OUT_DIR,
    required: true,
  },
  {
    id: "apex-landing",
    cwd: resolve(SAMPLES_ROOT, "recipes/apex-landing"),
    command: ["bun", "run", "screenshot"],
    out: resolve(SAMPLES_ROOT, "recipes/apex-landing/screenshots"),
    required: true,
    after: () => syncLightboxAssets(SAMPLES_ROOT),
  },
  {
    id: "marketing-demo",
    cwd: resolve(SAMPLES_ROOT, "apps/marketing-demo"),
    command: ["bun", "run", "screenshots"],
    out: `${APPS_OUT}/marketing-demo`,
  },
  {
    id: "ui-walkthrough",
    cwd: resolve(SAMPLES_ROOT, "apps/ui-walkthrough"),
    command: SCREENSHOTS_CMD,
    out: `${APPS_OUT}/ui-walkthrough`,
  },
  {
    id: "workspaces",
    cwd: resolve(SAMPLES_ROOT, "apps/workspaces"),
    command: SCREENSHOTS_CMD,
    out: `${APPS_OUT}/workspaces`,
  },
  {
    id: "showcase",
    cwd: resolve(SAMPLES_ROOT, "apps/showcase"),
    command: ["bun", "run", "screenshot"],
    out: `${APPS_OUT}/showcase`,
  },
];

async function runRunner(r: Runner): Promise<void> {
  mkdirSync(r.out, { recursive: true });
  console.log(`\n→ ${r.id} …`);
  const proc = Bun.spawn([...r.command], {
    cwd: r.cwd,
    env: { ...process.env, SCREENSHOT_DIR: r.out, CI: "1" },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    if (r.required) {
      throw new Error(`${r.id} screenshots failed (exit ${code}) — required runner, aborting`);
    }
    console.warn(`warn: ${r.id} screenshots failed (exit ${code}) — need .env + Postgres?`);
    return;
  }
  r.after?.();
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

async function runAllScreenshots(): Promise<void> {
  if (process.env["SKIP_APP_SCREENSHOTS"] === "1") {
    console.log("SKIP_APP_SCREENSHOTS=1 — skipping live captures");
    syncLightboxAssets(SAMPLES_ROOT);
    return;
  }
  for (const runner of SCREENSHOT_RUNNERS) await runRunner(runner);
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
  ${section("Bundled features (live UI)", featurePngs)}
  ${section("Sample apps (live UI)", appPngs)}
</body>
</html>
`;
  const indexPath = `${OUT_DIR}/index.html`;
  writeFileSync(indexPath, html, "utf-8");
  console.log(`\nwrote ${indexPath} (${featurePngs.length} feature + ${appPngs.length} app PNGs)`);
}

function writeScreenshotManifest(): void {
  const scenarios: string[] = [];
  if (existsSync(OUT_DIR)) {
    for (const entry of readdirSync(OUT_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "apps" || entry.name.startsWith(".")) continue;
      const enDir = join(OUT_DIR, entry.name, "en");
      if (existsSync(enDir)) scenarios.push(entry.name);
    }
  }
  scenarios.sort();
  const manifestPath = `${OUT_DIR}/screenshot-manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify({ scenarios }, null, 2)}\n`, "utf-8");
  console.log(`wrote ${manifestPath} (${scenarios.length} matrix scenarios)`);
}

async function main(): Promise<void> {
  console.log(`screenshot dir: ${OUT_DIR}`);
  await runAllScreenshots();
  copyConfigScreenshot();
  writeScreenshotManifest();
  writePreviewIndex();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
