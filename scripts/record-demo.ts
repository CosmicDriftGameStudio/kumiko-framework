// record-demo — Iter 2 of Phase 3 (Plan-Doc D8). Orchestrates the full
// recording stack on macOS:
//   1. tmux session with the terminal pane positioned LEFT
//   2. chromium headed via Playwright positioned RIGHT
//   3. ffmpeg avfoundation captures the combined screen rectangle
//   4. walks the DemoDef step-by-step (typing delays for CLI, page actions
//      for browser, cat-into-file for editor)
//   5. converts mp4 → palette-optimized gif
//   6. writes captions.json with the cumulative step timings
//
// Output: apps/marketing/public/hero/{demo.gif, demo-poster.png,
// captions.json} — copy these into the kumiko-platform repo (PR #250).
//
// Usage:
//   bun scripts/record-demo.ts                # records 01-create-app
//   bun scripts/record-demo.ts --demo=02      # records 02-add-billing
//   bun scripts/record-demo.ts --dry-run      # walks steps without ffmpeg
//
// See scripts/demos/RECORDING.md for the brew installs + screen-recording
// permission setup.

import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Browser, chromium, type Page } from "playwright";
import type { DemoDef } from "./demos/demo";
import type { Step } from "./demos/step";

// ─── geometry ────────────────────────────────────────────────────────────────
// Both windows are 1280×720; total capture rect is 2560×720. ffmpeg scales it
// to 1920×540 for the output GIF (half-width per pane). Keep these in sync
// with the osascript window-positioning calls below.
const PANE_W = 1280;
const PANE_H = 720;
const GIF_W = 1920; // 2× downscale of 2560 capture
const GIF_FPS = 15;
const TYPE_DELAY_MS = 60; // per-keystroke delay for tmux send-keys CLI typing

// ─── output paths ────────────────────────────────────────────────────────────
const REPO_ROOT = resolve(import.meta.dir, "..");
const OUTPUT_DIR = join(REPO_ROOT, "dist", "hero-recording");
const MP4_PATH = join(OUTPUT_DIR, "demo.mp4");
const GIF_PATH = join(OUTPUT_DIR, "demo.gif");
const POSTER_PATH = join(OUTPUT_DIR, "demo-poster.png");
const CAPTIONS_PATH = join(OUTPUT_DIR, "captions.json");

// ─── args ────────────────────────────────────────────────────────────────────
type Args = { demo: string; dryRun: boolean };
function parseArgs(argv: readonly string[]): Args {
  const out: Args = { demo: "01-create-app", dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--demo=")) {
      const v = a.slice(7);
      // Accept "01" → match the 01-*.ts file; accept "01-create-app" verbatim.
      out.demo = /^\d+$/.test(v) ? resolveDemoByPrefix(v) : v;
    }
  }
  return out;
}

function resolveDemoByPrefix(prefix: string): string {
  const files = readdirSync(join(REPO_ROOT, "scripts", "demos")).filter((f) =>
    f.startsWith(`${prefix}-`),
  );
  if (files.length === 0) throw new Error(`No demo file with prefix "${prefix}-"`);
  return files[0]!.replace(/\.ts$/, "");
}

// ─── preflight ───────────────────────────────────────────────────────────────
function checkTool(cmd: string, brewHint: string): void {
  // execFileSync via `which` — no shell, so a tool-name with shell-special
  // chars (none today, but defense-in-depth) never injects.
  const r = spawnSync("which", [cmd], { stdio: "ignore" });
  if (r.status !== 0) {
    throw new Error(`Missing required tool: ${cmd}. Install with: ${brewHint}`);
  }
}

function preflight(): void {
  if (process.platform !== "darwin") {
    throw new Error("record-demo is macOS-only (uses tmux + ffmpeg avfoundation + osascript)");
  }
  checkTool("tmux", "brew install tmux");
  checkTool("ffmpeg", "brew install ffmpeg");
  checkTool("docker", "Install Docker Desktop from https://docker.com");
  // ffmpeg avfoundation needs Screen Recording permission for the launching
  // terminal — System Settings → Privacy & Security → Screen Recording.
  // We can't programmatically check the permission, so the first capture
  // attempt simply fails loudly if it's not granted.
}

// ─── tmux helpers ────────────────────────────────────────────────────────────
const SESSION = "kumiko-demo";

function tmux(args: readonly string[]): void {
  const r = spawnSync("tmux", [...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`tmux ${args.join(" ")} failed`);
}

function tmuxStart(): void {
  // Detach any prior session so a re-run starts clean.
  spawnSync("tmux", ["kill-session", "-t", SESSION], { stdio: "ignore" });
  tmux(["new-session", "-d", "-s", SESSION, "-x", "160", "-y", "40"]);
  // Wait for the session window to register.
  spawnSync("tmux", ["send-keys", "-t", SESSION, "clear", "Enter"], { stdio: "ignore" });
}

function tmuxType(text: string, delayMs = TYPE_DELAY_MS): Promise<void> {
  // tmux send-keys with -l (literal) types one chunk; for a real typing-feel
  // we split into single chars with sleep between.
  return (async () => {
    for (const ch of text) {
      spawnSync("tmux", ["send-keys", "-t", SESSION, "-l", ch], { stdio: "ignore" });
      await sleep(delayMs);
    }
  })();
}

function tmuxEnter(): void {
  spawnSync("tmux", ["send-keys", "-t", SESSION, "Enter"], { stdio: "ignore" });
}

function tmuxKill(): void {
  spawnSync("tmux", ["kill-session", "-t", SESSION], { stdio: "ignore" });
}

// ─── window positioning (macOS osascript) ────────────────────────────────────
// Best-effort: positions the front-most Terminal window LEFT and chromium
// RIGHT. The user can re-adjust manually before recording starts if needed.
function positionWindows(): void {
  const left = `tell application "System Events" to tell process "Terminal"
    set position of window 1 to {0, 0}
    set size of window 1 to {${PANE_W}, ${PANE_H}}
  end tell`;
  const right = `tell application "System Events" to tell process "Chromium"
    set position of window 1 to {${PANE_W}, 0}
    set size of window 1 to {${PANE_W}, ${PANE_H}}
  end tell`;
  spawnSync("osascript", ["-e", left], { stdio: "ignore" });
  spawnSync("osascript", ["-e", right], { stdio: "ignore" });
}

// ─── ffmpeg capture ──────────────────────────────────────────────────────────
let ffmpegProc: ChildProcess | undefined;

function startCapture(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  // -f avfoundation -i "1:none" → screen index 1, no audio. (Index 1 is the
  // first display on most Macs; "0" is iSight camera. Adjust if recording
  // fails with "Selected device is not capable".)
  // -filter:v crop=W:H:X:Y crops to the combined two-pane rectangle.
  // -pix_fmt yuv420p + -movflags +faststart for broad mp4 compatibility.
  const args = [
    "-f",
    "avfoundation",
    "-framerate",
    String(GIF_FPS),
    "-capture_cursor",
    "1",
    "-i",
    "1:none",
    "-vf",
    `crop=${PANE_W * 2}:${PANE_H}:0:0`,
    "-pix_fmt",
    "yuv420p",
    "-y",
    MP4_PATH,
  ];
  ffmpegProc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
}

async function stopCapture(): Promise<void> {
  if (!ffmpegProc) return;
  // Graceful SIGINT lets ffmpeg flush its container.
  ffmpegProc.kill("SIGINT");
  await new Promise((r) => {
    ffmpegProc?.on("exit", r);
  });
  ffmpegProc = undefined;
}

function mp4ToGif(): void {
  // Two-pass: generate a palette tuned to the actual video, then encode with
  // it. Without this you get banded/dithered GIFs at 256 colors.
  // execFileSync (arg-array, no shell) so paths with spaces / shell-special
  // chars never inject into a command line.
  const palette = join(OUTPUT_DIR, "palette.png");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      MP4_PATH,
      "-vf",
      `fps=${GIF_FPS},scale=${GIF_W}:-1:flags=lanczos,palettegen`,
      palette,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      MP4_PATH,
      "-i",
      palette,
      "-lavfi",
      `fps=${GIF_FPS},scale=${GIF_W}:-1:flags=lanczos [x]; [x][1:v] paletteuse`,
      GIF_PATH,
    ],
    { stdio: "inherit" },
  );
  // Poster = first frame, downscaled identically so the placeholder matches.
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      MP4_PATH,
      "-vf",
      `scale=${GIF_W}:-1:flags=lanczos`,
      "-vframes",
      "1",
      POSTER_PATH,
    ],
    { stdio: "inherit" },
  );
}

// ─── playwright ──────────────────────────────────────────────────────────────
let browser: Browser | undefined;
let page: Page | undefined;

async function launchBrowser(): Promise<void> {
  browser = await chromium.launch({
    headless: false,
    args: [`--window-size=${PANE_W},${PANE_H}`, `--window-position=${PANE_W},0`],
  });
  const ctx = await browser.newContext({ viewport: { width: PANE_W, height: PANE_H } });
  page = await ctx.newPage();
}

async function closeBrowser(): Promise<void> {
  await page?.close();
  await browser?.close();
  browser = undefined;
  page = undefined;
}

// ─── step executor ───────────────────────────────────────────────────────────
type StepTiming = { startMs: number; endMs: number; step: Step };

async function execute(demo: DemoDef): Promise<readonly StepTiming[]> {
  const timings: StepTiming[] = [];
  const t0 = performance.now();

  for (const step of demo.steps) {
    const startMs = Math.round(performance.now() - t0);

    if (step.kind === "cli") {
      await tmuxType(step.type);
      tmuxEnter();
      // Heuristic wait: long commands need time to produce output before the
      // next step lands on top of them. Captions also need a beat to be read.
      await sleep(2500);
    } else if (step.kind === "browser") {
      if (!page) throw new Error("browser step before launchBrowser()");
      if (step.navigate) await page.goto(step.navigate);
      if (step.click) await page.click(step.click);
      if (step.waitFor) await page.waitForSelector(step.waitFor);
      await sleep(1500);
    } else {
      // editor: write the file via a heredoc and `cat` it for visual context.
      const escaped = step.write.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
      await tmuxType(`cat > ${step.file} <<'EOF'`);
      tmuxEnter();
      // Reveal the content in chunks so the viewer can read along.
      for (const line of escaped.split("\n")) {
        await tmuxType(line, 8);
        tmuxEnter();
      }
      await tmuxType("EOF");
      tmuxEnter();
      await sleep(1500);
    }

    timings.push({ startMs, endMs: Math.round(performance.now() - t0), step });
  }
  return timings;
}

// ─── captions ────────────────────────────────────────────────────────────────
function writeCaptions(demo: DemoDef, timings: readonly StepTiming[]): void {
  const steps = timings
    .filter((t) => !!t.step.caption)
    .map((t) => ({
      start_ms: t.startMs,
      end_ms: t.endMs,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      de: t.step.caption!.de,
      // biome-ignore lint/style/noNonNullAssertion: filtered above
      en: t.step.caption!.en,
    }));
  const totalMs = timings.length > 0 ? timings[timings.length - 1]!.endMs : 0;
  const captions = {
    version: 1,
    demo: demo.title,
    duration_ms: totalMs,
    steps,
  };
  writeFileSync(CAPTIONS_PATH, `${JSON.stringify(captions, null, 2)}\n`);
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  preflight();

  const demoMod = (await import(`./demos/${args.demo}`)) as { default: DemoDef };
  const demo = demoMod.default;
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log(`[record-demo] demo=${demo.title} dry-run=${args.dryRun}`);

  if (args.dryRun) {
    // biome-ignore lint/suspicious/noConsole: progress UX
    console.log(`[record-demo] would record ${demo.steps.length} steps`);
    return;
  }

  tmuxStart();
  await launchBrowser();
  positionWindows();
  await sleep(1500); // give the WM a beat to settle
  startCapture();
  await sleep(500); // ffmpeg warm-up before the first action lands

  try {
    const timings = await execute(demo);
    await sleep(1500); // tail-padding so the last frame isn't cut mid-step
    await stopCapture();
    mp4ToGif();
    writeCaptions(demo, timings);
    // biome-ignore lint/suspicious/noConsole: result paths
    console.log(`\n[record-demo] done:\n  ${GIF_PATH}\n  ${POSTER_PATH}\n  ${CAPTIONS_PATH}`);
    // biome-ignore lint/suspicious/noConsole: next-step hint
    console.log(
      "\nCopy these into kumiko-platform/apps/marketing/public/hero/ to lift draft on PR #250.",
    );
  } finally {
    await stopCapture();
    await closeBrowser();
    tmuxKill();
  }
}

if (import.meta.main) {
  main().catch((e) => {
    // biome-ignore lint/suspicious/noConsole: top-level error
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
}

// ─── exports for unit-tests ──────────────────────────────────────────────────
// parseArgs + resolveDemoByPrefix are pure; the rest (tmux/ffmpeg/playwright
// orchestration) needs a real Mac to exercise and isn't exported.
export { parseArgs, resolveDemoByPrefix };
