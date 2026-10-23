// Scaffold + boot helper for hero-demo E2E. Invoked as the
// playwright.config webServer command — process stays alive serving the
// demo app on PORT, dies when playwright sends SIGTERM.
//
// Programmatically calls `create-kumiko-app`'s runCreate() against the
// HEAD source (no npm roundtrip), writes a .env with the test stack
// URLs, packs every public package from HEAD the way the release does and
// installs the app against those tarballs (scaffold is kept across reruns),
// then execs `bun dev`. PORT comes from the playwright config.
//
// Usage: bun e2e/hero-demos/boot-demo.ts <demo-name>
//        (demo-name picks the scaffold dir under e2e/hero-demos/.tmp/)

import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exitStatusFromChild } from "../../bin/commands/_spawn.ts";
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

type PackageJson = {
  name?: unknown;
  private?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

function readPackageJson(pkgJsonPath: string): PackageJson {
  return JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as PackageJson;
}

function packOnePackage(repoRoot: string, pkgName: string, pkgDir: string): Promise<string> {
  return new Promise((resolvePack, rejectPack) => {
    const child = spawn("bash", ["scripts/pack-with-publish-config.sh", pkgDir], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", rejectPack);
    child.on("exit", (code) => {
      if (code !== 0) {
        rejectPack(new Error(`packing ${pkgName} failed with exit code ${code}`));
        return;
      }
      resolvePack(stdout.trim());
    });
  });
}

async function packWorkspacePackages(
  repoRoot: string,
  outDir: string,
): Promise<Map<string, string>> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const packagesDir = resolve(repoRoot, "packages");
  const publicPackages: { name: string; dir: string }[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(packagesDir, entry.name);
    const pkgJsonPath = resolve(dir, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = readPackageJson(pkgJsonPath);
    if (pkg.private === true) continue;
    if (typeof pkg.name !== "string") {
      throw new Error(`${pkgJsonPath} has no string name`);
    }
    publicPackages.push({ name: pkg.name, dir });
  }

  console.log(`[boot-demo] packing ${publicPackages.length} packages…`);
  const entries = await Promise.all(
    publicPackages.map(async ({ name, dir }): Promise<[string, string]> => {
      const tarballName = await packOnePackage(repoRoot, name, dir);
      const tarballPath = resolve(outDir, tarballName);
      renameSync(resolve(dir, tarballName), tarballPath);
      return [name, tarballPath];
    }),
  );
  return new Map(entries);
}

function pinCosmicDriftToTarballs(appDir: string, tarballs: Map<string, string>): void {
  const pkgPath = resolve(appDir, "package.json");
  const pkg = readPackageJson(pkgPath);
  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  const overrides: Record<string, string> = { ...(pkg.overrides ?? {}) };
  for (const [name, tarballPath] of tarballs) {
    const pin = `file:${tarballPath}`;
    if (deps[name] !== undefined) deps[name] = pin;
    if (devDeps[name] !== undefined) devDeps[name] = pin;
    overrides[name] = pin;
  }
  pkg.dependencies = deps;
  pkg.devDependencies = devDeps;
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
}

// Installing from tarballs mirrors a consumer of the published packages; a file: directory pin
// would also install the package's own workspace graph (oven-sh/bun#44968).
const tarballs = await packWorkspacePackages(REPO_ROOT, resolve(TMP_ROOT, `${demoName}-tarballs`));
pinCosmicDriftToTarballs(appDir, tarballs);
// Tarballs keep the same name and version across reruns, so an old lockfile or install
// would keep the previous extraction.
rmSync(resolve(appDir, "node_modules"), { recursive: true, force: true });
rmSync(resolve(appDir, "bun.lock"), { force: true });
console.log("[boot-demo] bun install (tarballs)…");
execFileSync("bun", ["install"], { cwd: appDir, stdio: "inherit" });

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
child.on("exit", (code, signal) => process.exit(exitStatusFromChild(code, signal)));
