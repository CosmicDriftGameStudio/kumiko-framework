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
import { connect } from "node:net";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Browser, chromium, type Page } from "playwright";
import type { DemoDef } from "./demos/demo";
import type { Step } from "./demos/step";

// ─── geometry ────────────────────────────────────────────────────────────────
// Each pane = half the main display's visible frame (no overlap). ffmpeg crops
// that combined rectangle. Override for debugging: RECORD_DEMO_GEOMETRY=1280x720
const GIF_W = 1920;
const GIF_FPS = 15;
const TYPE_DELAY_MS = 60;

export type CaptureGeometry = {
  readonly originX: number;
  readonly originY: number;
  readonly paneW: number;
  readonly paneH: number;
  readonly captureW: number;
  readonly captureH: number;
};

/** Parse `w,h,x,y` from NSScreen visibleFrame (unit-test hook). */
export function geometryFromVisibleFrame(
  visW: number,
  visH: number,
  originX: number,
  originY: number,
): CaptureGeometry {
  const paneW = Math.floor(visW / 2);
  const paneH = visH;
  return {
    originX,
    originY,
    paneW,
    paneH,
    captureW: paneW * 2,
    captureH: paneH,
  };
}

function osascriptLine(script: string): string | undefined {
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) return undefined;
  const line = r.stdout?.trim();
  return line && line.length > 0 ? line : undefined;
}

function parseGeometryCsv(raw: string): CaptureGeometry | undefined {
  const parts = raw.split(",").map((s) => Number.parseInt(s, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return undefined;
  const [visW, visH, originX, originY] = parts as [number, number, number, number];
  if (visW < 800 || visH < 600) return undefined;
  return geometryFromVisibleFrame(visW, visH, originX, originY);
}

function resolveCaptureGeometry(): CaptureGeometry {
  const override = process.env.RECORD_DEMO_GEOMETRY;
  if (override) {
    const m = /^(\d+)x(\d+)$/.exec(override);
    if (!m) throw new Error(`RECORD_DEMO_GEOMETRY must be WxH, got "${override}"`);
    const paneW = Number(m[1]);
    const paneH = Number(m[2]);
    return {
      originX: 0,
      originY: 0,
      paneW,
      paneH,
      captureW: paneW * 2,
      captureH: paneH,
    };
  }

  // macOS 26+: AppKit `round()` on visibleFrame values throws (-10000). Use `as integer`.
  const appKit = `
use framework "AppKit"
set vf to current application's NSScreen's mainScreen's visibleFrame()
set w to (current application's NSWidth(vf)) as integer
set h to (current application's NSHeight(vf)) as integer
set x to (current application's NSMinX(vf)) as integer
set y to (current application's NSMinY(vf)) as integer
return (w as text) & "," & (h as text) & "," & (x as text) & "," & (y as text)`;
  const fromAppKit = osascriptLine(appKit);
  if (fromAppKit) {
    const g = parseGeometryCsv(fromAppKit);
    if (g) return g;
  }

  // Fallback: full desktop bounds (menu bar included — good enough for crop).
  const finder = `tell application "Finder"
  set b to bounds of window of desktop
  return "" & (item 3 of b as text) & "," & (item 4 of b as text) & ",0,0"
end tell`;
  const fromFinder = osascriptLine(finder);
  if (fromFinder) {
    const g = parseGeometryCsv(fromFinder);
    if (g) return g;
  }

  // biome-ignore lint/suspicious/noConsole: fallback hint
  console.warn(
    "[record-demo] could not read screen size via osascript — using 2560×720 fallback. " +
      "Set RECORD_DEMO_GEOMETRY=1280x800 to override.",
  );
  return geometryFromVisibleFrame(2560, 720, 0, 0);
}

let geom: CaptureGeometry = geometryFromVisibleFrame(2560, 720, 0, 0);

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

/** Isolated cwd — never scaffold into this repo's ./demo/ sample app. */
const RECORD_WORKDIR =
  process.env.RECORD_DEMO_WORKDIR ?? join("/tmp", "kumiko-hero-recording");

const OSASCRIPT_MS = 8_000;

function runOsascript(script: string, label: string): boolean {
  const r = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: OSASCRIPT_MS,
  });
  if (r.status === 0) return true;
  const err = (r.stderr ?? "").trim();
  if (err.includes("assistive access") || err.includes("-1719")) {
    // biome-ignore lint/suspicious/noConsole: permission hint
    console.warn(
      `[record-demo] ${label}: Accessibility denied — enable Terminal/osascript in ` +
        "System Settings → Privacy & Security → Accessibility.",
    );
    return false;
  }
  if (r.error?.code === "ETIMEDOUT") {
    // biome-ignore lint/suspicious/noConsole: permission hint
    console.warn(`[record-demo] ${label}: osascript timed out`);
    return false;
  }
  if (err) {
    // biome-ignore lint/suspicious/noConsole: permission hint
    console.warn(`[record-demo] ${label}: ${err}`);
  }
  return false;
}

/** Playwright's headed chromium on macOS — not "Chromium". */
const BROWSER_PROCESS_NAMES = [
  "Google Chrome for Testing",
  "Chromium",
  "Google Chrome",
] as const;

function tmux(args: readonly string[]): void {
  const r = spawnSync("tmux", [...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`tmux ${args.join(" ")} failed`);
}

/** Opens a visible left-pane terminal attached to the demo tmux session. */
function tmuxStart(): void {
  spawnSync("tmux", ["kill-session", "-t", SESSION], { stdio: "ignore" });
  spawnSync("tmux", ["new-session", "-d", "-s", SESSION, "-x", "200", "-y", "50"], {
    stdio: "ignore",
  });

  const termApp = process.env.RECORD_DEMO_TERMINAL ?? "Terminal";
  if (termApp === "iTerm2") {
    runOsascript(buildITermAttachScript(geom), "iTerm attach");
  } else {
    runOsascript(buildTerminalAttachScript(geom), "Terminal attach");
  }

  spawnSync("tmux", ["send-keys", "-t", SESSION, "clear", "Enter"], { stdio: "ignore" });
  const cdCmd = `mkdir -p ${RECORD_WORKDIR} && cd ${RECORD_WORKDIR} && clear`;
  spawnSync("tmux", ["send-keys", "-t", SESSION, "-l", cdCmd], { stdio: "ignore" });
  spawnSync("tmux", ["send-keys", "-t", SESSION, "Enter"], { stdio: "ignore" });
}

function buildTerminalAttachScript(g: CaptureGeometry): string {
  return `
tell application "Terminal"
  activate
  do script "tmux attach -t ${SESSION}"
  delay 0.6
end tell
tell application "System Events" to tell process "Terminal"
  set position of front window to {${g.originX}, ${g.originY}}
  set size of front window to {${g.paneW}, ${g.paneH}}
end tell`;
}

function buildITermAttachScript(g: CaptureGeometry): string {
  return `
tell application "iTerm2"
  activate
  create window with default profile
  tell current session of current window
    write text "tmux attach -t ${SESSION}"
  end tell
  delay 0.6
end tell
tell application "System Events" to tell process "iTerm2"
  set position of front window to {${g.originX}, ${g.originY}}
  set size of front window to {${g.paneW}, ${g.paneH}}
end tell`;
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
function positionBrowserWindow(g: CaptureGeometry): void {
  const rightX = g.originX + g.paneW;
  for (const processName of BROWSER_PROCESS_NAMES) {
    const script = `tell application "System Events" to tell process "${processName}"
    if (count of windows) > 0 then
      set position of front window to {${rightX}, ${g.originY}}
      set size of front window to {${g.paneW}, ${g.paneH}}
    end if
  end tell`;
    const r = spawnSync("osascript", ["-e", script], { stdio: "pipe", encoding: "utf8" });
    if (r.status === 0) {
      // biome-ignore lint/suspicious/noConsole: setup feedback
      console.log(`[record-demo] positioned browser (${processName}) ${g.paneW}×${g.paneH} @ ${rightX},${g.originY}`);
      return;
    }
  }
  // biome-ignore lint/suspicious/noConsole: setup warning
  console.warn(
    "[record-demo] could not position browser window via osascript — relying on --window-position",
  );
}

function positionWindows(): void {
  const termProcess = process.env.RECORD_DEMO_TERMINAL === "iTerm2" ? "iTerm2" : "Terminal";
  const left = `tell application "System Events" to tell process "${termProcess}"
    if (count of windows) > 0 then
      set position of front window to {${geom.originX}, ${geom.originY}}
      set size of front window to {${geom.paneW}, ${geom.paneH}}
    end if
  end tell`;
  spawnSync("osascript", ["-e", left], { stdio: "inherit" });
  positionBrowserWindow(geom);
}

// ─── ffmpeg capture ──────────────────────────────────────────────────────────
let ffmpegProc: ChildProcess | undefined;

function detectScreenIndex(): string {
  // avfoundation indices shift between Macs (cameras, Desk View, externals).
  // Parse `-list_devices` output, match the line that says "Capture screen 0"
  // and return its bracketed index. Falls back to "1" with a warning.
  const r = spawnSync("ffmpeg", ["-f", "avfoundation", "-list_devices", "true", "-i", ""], {
    encoding: "utf8",
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const m = out.match(/\[(\d+)\]\s*Capture screen 0/);
  if (m?.[1]) return m[1];
  // biome-ignore lint/suspicious/noConsole: preflight warning
  console.warn('[record-demo] could not detect "Capture screen 0" index, falling back to 1');
  return "1";
}

function startCapture(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const screenIdx = detectScreenIndex();
  // -f avfoundation -i "<idx>:none" → screen index, no audio. Index is
  // auto-detected from avfoundation's device list — typically 2 on Mac
  // laptops (after the cameras) but varies with attached displays / iPhones.
  // -filter:v crop=W:H:X:Y crops to the combined two-pane rectangle.
  // -pix_fmt yuv420p for broad mp4 compatibility.
  const args = [
    "-f",
    "avfoundation",
    "-framerate",
    String(GIF_FPS),
    "-capture_cursor",
    "1",
    "-i",
    `${screenIdx}:none`,
    "-vf",
    `crop=${geom.captureW}:${geom.captureH}:${geom.originX}:${geom.originY}`,
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
  const rightX = geom.originX + geom.paneW;
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log(`[record-demo] launching Chromium @ ${rightX},${geom.originY} …`);
  browser = await chromium.launch({
    headless: false,
    timeout: 30_000,
    args: [
      `--window-size=${geom.paneW},${geom.paneH}`,
      `--window-position=${rightX},${geom.originY}`,
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: geom.paneW, height: geom.paneH },
  });
  page = await ctx.newPage();
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log("[record-demo] Chromium ready");
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = connect({ host: "localhost", port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
      sock.setTimeout(500, () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`waitForPort: localhost:${port} did not accept connections within ${timeoutMs}ms`);
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
      if (step.waitForPort !== undefined) {
        await waitForPort(step.waitForPort, 60_000);
      } else {
        await sleep(step.waitMs ?? 2500);
      }
    } else if (step.kind === "browser") {
      if (!page) throw new Error("browser step before launchBrowser()");
      if (step.navigate) await page.goto(step.navigate);
      if (step.fill) {
        for (const [sel, val] of Object.entries(step.fill)) {
          await page.fill(sel, val);
        }
      }
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

  geom = resolveCaptureGeometry();
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log(
    `[record-demo] workdir=${RECORD_WORKDIR}\n` +
      `[record-demo] geometry: ${geom.paneW}×${geom.paneH} per pane, ` +
      `capture ${geom.captureW}×${geom.captureH} @ (${geom.originX},${geom.originY})`,
  );
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log(
    "[record-demo] Watch THIS terminal for progress — the new Terminal window is only the CLI pane.",
  );

  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log("[record-demo] step 1/5 — open CLI pane (tmux) …");
  tmuxStart();
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log("[record-demo] step 2/5 — launch Chromium …");
  await launchBrowser();
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log("[record-demo] step 3/5 — layout split-screen …");
  await layoutSplitScreen();
  await sleep(2500);
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log("[record-demo] step 4/5 — start ffmpeg capture …");
  startCapture();
  await sleep(500);
  // biome-ignore lint/suspicious/noConsole: progress UX
  console.log("[record-demo] step 5/5 — execute demo steps …");

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






















