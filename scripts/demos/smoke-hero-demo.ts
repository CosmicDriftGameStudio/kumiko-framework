#!/usr/bin/env bun
// Headless smoke for hero create-app demo — no tmux/ffmpeg/screen capture.
// Runs: validate → scaffold → install → .env → bun dev (port probe).
// ponytail: foundation scaffold (install.sh without --yes); skip `bun run boot`
// — prod dry-run hits PII/KMS gates the recording path never exercises.
//
// Usage: bun scripts/demos/smoke-hero-demo.ts

import { execFileSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { scaffoldApp } from "../../packages/dev-server/src/scaffold-app.ts";
import { validateDemoSchema } from "../demo-kit/engine/validate-schema.ts";
import { hydrateDemo } from "../demo-kit/engine/hydrate.ts";

const KIT_ROOT = join(import.meta.dir, "../demo-kit");
const ENV_FIXTURE = readFileSync(
  join(KIT_ROOT, "demos/create-app/fixtures/env.recording.env"),
  "utf8",
);
const PORT = Number(process.env.SMOKE_PORT ?? "3000");

function fail(msg: string): never {
  console.error(`[smoke-hero-demo] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`[smoke-hero-demo] ✓ ${msg}`);
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const up = await new Promise<boolean>((resolvePort) => {
      const sock = connect({ host: "127.0.0.1", port }, () => {
        sock.destroy();
        resolvePort(true);
      });
      sock.on("error", () => resolvePort(false));
      sock.setTimeout(400, () => {
        sock.destroy();
        resolvePort(false);
      });
    });
    if (up) return;
    await sleep(400);
  }
  fail(`localhost:${port} did not accept connections within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  console.log("[smoke-hero-demo] validate create-app schema …");
  const errors = validateDemoSchema("create-app", KIT_ROOT);
  if (errors.length > 0) fail(errors.join("; "));
  ok("demo-kit schema");

  const def = hydrateDemo({ demoId: "create-app", kitRoot: KIT_ROOT });
  if (def.steps.length !== 14) fail(`expected 14 steps, got ${def.steps.length}`);
  ok(`hydrate ${def.steps.length} steps`);

  const workRoot = mkdtempSync(join(tmpdir(), "kumiko-hero-smoke-"));
  const appDir = join(workRoot, "hero-app");
  console.log(`[smoke-hero-demo] scaffold into ${workRoot} …`);
  await scaffoldApp({ name: "hero-app", cwd: workRoot });
  if (!existsSync(join(appDir, "package.json"))) fail("hero-app/package.json missing");
  ok("scaffold");

  console.log("[smoke-hero-demo] bun install …");
  execFileSync("bun", ["install"], { cwd: appDir, stdio: "inherit" });
  ok("install");

  console.log("[smoke-hero-demo] patch tasks i18n (published scaffold) …");
  execFileSync("bun", [join(import.meta.dir, "patch-published-scaffold-tasks.ts"), "hero-app"], {
    cwd: workRoot,
    stdio: "inherit",
  });
  ok("patch tasks i18n");

  writeFileSync(join(appDir, ".env"), ENV_FIXTURE);
  ok(".env fixture");

  console.log(`[smoke-hero-demo] bun dev on :${PORT} (60s probe) …`);
  const child = spawn("bun", ["dev"], {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, PORT: String(PORT) },
  });

  try {
    await waitForPort(PORT, 60_000);
    ok(`dev server :${PORT}`);
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
    if (!child.killed) child.kill("SIGKILL");
  }

  rmSync(workRoot, { recursive: true, force: true });
  console.log("\n[smoke-hero-demo] all checks passed");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});



