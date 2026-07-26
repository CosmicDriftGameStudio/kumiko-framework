// Scaffold + boot helper for hero-demo E2E. Invoked as the
// playwright.config webServer command — process stays alive serving the
// demo app on PORT, dies when playwright sends SIGTERM.
//
// Programmatically calls `create-kumiko-app`'s runCreate() against the
// HEAD source (no npm roundtrip), writes a .env with the test stack
// URLs, relinks @cosmicdrift/* to the monorepo then installs (cached across reruns by leaving the dir),
// then execs `bun dev`. PORT comes from the playwright config.
//
// Usage: bun e2e/hero-demos/boot-demo.ts <demo-name>
//        (demo-name picks the scaffold dir under e2e/hero-demos/.tmp/)

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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


const PACKAGE_DIRS: Readonly<Record<string, string>> = {
  "@cosmicdrift/kumiko-bundled-features": "packages/bundled-features",
  "@cosmicdrift/kumiko-cli": "packages/cli",
  "@cosmicdrift/kumiko-dev-server": "packages/dev-server",
  "@cosmicdrift/kumiko-dispatcher-live": "packages/dispatcher-live",
  "@cosmicdrift/kumiko-framework": "packages/framework",
  "@cosmicdrift/kumiko-headless": "packages/headless",
  "@cosmicdrift/kumiko-renderer": "packages/renderer",
  "@cosmicdrift/kumiko-renderer-web": "packages/renderer-web",
  "@cosmicdrift/kumiko-server-runtime": "packages/server-runtime",
  "@cosmicdrift/kumiko-types": "packages/types",
  "create-kumiko-app": "packages/create-kumiko-app",
};

function filePin(repoRoot: string, rel: string): string {
  return `file:${resolve(repoRoot, rel)}`;
}

/** Rewrite scaffolded @cosmicdrift/* deps + overrides so nested workspace:*
 *  refs resolve via file: pins (hero-app sits outside the monorepo workspaces). */
function relinkCosmicDriftToWorkspace(appDir: string, repoRoot: string): void {
  const pkgPath = resolve(appDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    dependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  const deps = pkg.dependencies ?? {};
  const overrides: Record<string, string> = { ...(pkg.overrides ?? {}) };
  for (const [name, rel] of Object.entries(PACKAGE_DIRS)) {
    const pin = filePin(repoRoot, rel);
    if (deps[name] !== undefined) deps[name] = pin;
    overrides[name] = pin;
  }
  pkg.dependencies = deps;
  pkg.overrides = overrides;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
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

  // Pin @cosmicdrift/* to this monorepo checkout. Hero scaffolds via HEAD
  // create-kumiko-app (e.g. #1514 drops PAT from --yes); published npm may
  // lag (e.g. #1571 session-only boot). Mixing HEAD scaffold + stale npm
  // false-fails the suite — workspace pins keep scaffold + runtime in lockstep.
  relinkCosmicDriftToWorkspace(appDir, REPO_ROOT);

  console.log("[boot-demo] bun install (workspace @cosmicdrift/* pins)…");
  execFileSync("bun", ["install"], { cwd: appDir, stdio: "inherit" });
}

writeFileSync(
  resolve(appDir, ".env"),
  [
    `TEST_DATABASE_URL=${testDb}`,
    `REDIS_URL=${redisUrl}`,
    "JWT_SECRET=hero-demo-e2e-secret-min-32-chars-aaaaa",
    "KUMIKO_SECRETS_MASTER_KEY_V1=QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
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


