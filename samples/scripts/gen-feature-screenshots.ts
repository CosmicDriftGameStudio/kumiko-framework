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
// Two output trees: screenshots/features/ backs the feature reference, while
// screenshots/samples/<recipe-dir>/ backs the sample pages — docgen reads that
// tree back and injects a ScreenshotPreview per scenario, so a new scenario
// needs no docs change. marketing-demo is the exception: its PNGs are copied
// from the marketing app's assets, not rendered here.
//
// Requires Postgres + Redis + a samples .env for app runners; apex-landing uses
// setContent only. Set SKIP_APP_SCREENSHOTS=1 to skip live captures (syncs
// committed hero-app.png into showcase public/ only).

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// Sample-app matrices live next to the feature matrix, keyed by the recipe's
// directory path — the docgen derives the same path from the sample's source,
// so a preview needs no name mapping. Only escape OUT_DIR by default (repo
// layout: kumiko-platform sits next to samples/); an explicit SCREENSHOT_DIR
// override nests samples inside it instead of writing outside the requested dir.
const SAMPLES_NESTED = process.env["SCREENSHOT_DIR"] !== undefined;
const SAMPLES_OUT = SAMPLES_NESTED ? join(OUT_DIR, "samples") : resolve(OUT_DIR, "..", "samples");
const SAMPLES_URL_PREFIX = SAMPLES_NESTED ? "samples" : "../samples";
const sampleOut = (dirPath: string) => join(SAMPLES_OUT, dirPath);

type Runner = {
  readonly id: string;
  readonly cwd: string;
  readonly command: readonly string[];
  readonly out: string;
  /** Fail the whole script when this runner exits non-zero. */
  readonly required?: boolean;
  /** Runs after a successful spawn (e.g. copy recipe assets into an app). */
  readonly after?: () => void;
  /** Wipe `out` before spawning — only safe for a runMatrix() sample-preview
   *  dir dedicated to this one runner. NOT set on use-all-bundled (`out` IS
   *  the shared features tree that marketing-demo/config.png also live
   *  under) or on apex-landing/marketing-demo (no runMatrix, no per-scenario
   *  dirs to go stale). */
  readonly cleanOut?: boolean;
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
    out: sampleOut("apps/ui-walkthrough"),
    cleanOut: true,
  },
  {
    id: "workspaces",
    cwd: resolve(SAMPLES_ROOT, "apps/workspaces"),
    command: SCREENSHOTS_CMD,
    out: sampleOut("apps/workspaces"),
    cleanOut: true,
  },
  {
    id: "showcase",
    cwd: resolve(SAMPLES_ROOT, "apps/showcase"),
    command: ["bun", "run", "screenshot"],
    out: sampleOut("apps/showcase"),
    cleanOut: true,
  },
  {
    id: "styleguide",
    cwd: resolve(SAMPLES_ROOT, "apps/styleguide"),
    command: SCREENSHOTS_CMD,
    out: sampleOut("apps/styleguide"),
    cleanOut: true,
  },
];

async function runRunner(r: Runner): Promise<void> {
  if (r.cleanOut) {
    // Renamed/removed scenarios leave their old directory behind —
    // findPreviews reads the tree as truth, so a stale dir keeps producing
    // a docgen preview for a scenario that no longer exists.
    rmSync(r.out, { recursive: true, force: true });
  }
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

function listPngs(
  dir: string,
  urlPrefix = "",
  labelPrefix = urlPrefix,
): Array<{ rel: string; label: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ rel: string; label: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = urlPrefix ? `${urlPrefix}/${entry.name}` : entry.name;
    const labelPath = labelPrefix ? `${labelPrefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listPngs(full, relPath, labelPath));
    } else if (entry.name.endsWith(".png")) {
      out.push({
        rel: `./${relPath}`,
        label: labelPath.replace(/\.png$/, "").replace(/\//g, " · "),
      });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function writePreviewIndex(): void {
  const featurePngs = listPngs(OUT_DIR).filter((p) => !p.rel.includes("/apps/"));
  const appPngs = listPngs(APPS_OUT, "apps");
  const samplePngs = listPngs(SAMPLES_OUT, SAMPLES_URL_PREFIX, "");

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
  ${section("Sample pages (docs preview matrix)", samplePngs)}
</body>
</html>
`;
  const indexPath = `${OUT_DIR}/index.html`;
  writeFileSync(indexPath, html, "utf-8");
  console.log(
    `\nwrote ${indexPath} (${featurePngs.length} feature + ${appPngs.length} app + ${samplePngs.length} sample PNGs)`,
  );
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
