// Scaffold + boot helper for hero-demo E2E. Invoked as the
// playwright.config webServer command — process stays alive serving the
// demo app on PORT, dies when playwright sends SIGTERM.
//
// Programmatically calls `create-kumiko-app`'s runCreate() against the
// HEAD source (no npm roundtrip), writes a .env with the test stack
// URLs, installs deps once (cached across reruns by leaving the dir),
// then execs `bun dev`. PORT comes from the playwright config.
//
// Usage: bun e2e/hero-demos/boot-demo.ts <demo-name>
//        (demo-name picks the scaffold dir under e2e/hero-demos/.tmp/)

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCreate } from "../../packages/create-kumiko-app/src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = resolve(HERE, ".tmp");
const REPO_ROOT = resolve(HERE, "../..");

const demoName = process.argv[2];
if (!demoName) {
  console.error("usage: boot-demo.ts <demo-name>");
  process.exit(1);
}

const port = process.env["PORT"] ?? "3000";
const testDb = process.env["TEST_DATABASE_URL"];
const redisUrl = process.env["REDIS_URL"] ?? "redis://127.0.0.1:16379";
if (!testDb) {
  console.error("[boot-demo] TEST_DATABASE_URL must be set");
  process.exit(1);
}

mkdirSync(TMP_ROOT, { recursive: true });

const appDir = resolve(TMP_ROOT, demoName);
const alreadyScaffolded = existsSync(resolve(appDir, "package.json"));

if (!alreadyScaffolded) {
  console.log(`[boot-demo] scaffolding ${demoName} into ${appDir}…`);
  const exit = await runCreate({ name: demoName, cwd: TMP_ROOT, yes: true });
  if (exit !== 0) {
    console.error(`[boot-demo] runCreate exited with ${exit}`);
    process.exit(exit);
  }

  console.log("[boot-demo] bun install (npm-published versions, mirrors user setup)…");
  execFileSync("bun", ["install"], { cwd: appDir, stdio: "inherit" });
}

writeFileSync(
  resolve(appDir, ".env"),
  [
    `TEST_DATABASE_URL=${testDb}`,
    `REDIS_URL=${redisUrl}`,
    "JWT_SECRET=hero-demo-e2e-secret-min-32-chars-aaaaa",
    "KUMIKO_SECRETS_MASTER_KEY_V1=aGVsbG90aGlzaXMzMmJ5dGVzZm9yYWVzMjU2a2V5cw==",
    `KUMIKO_DEV_DB_NAME=kumiko_hero_${demoName.replace(/-/g, "_")}`,
    "",
  ].join("\n"),
);

console.log(`[boot-demo] booting ${demoName} on :${port}`);
const child = spawn("bun", ["dev"], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, PORT: port },
});

const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
process.on("SIGTERM", forward("SIGTERM"));
process.on("SIGINT", forward("SIGINT"));
child.on("exit", (code) => process.exit(code ?? 0));

