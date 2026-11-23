import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { seedLockfileInDir } from "../seed-lockfile";

const REPO_LOCKFILE = resolve(import.meta.dir, "../../../../bun.lock");
const SERVICE_MANIFEST = resolve(import.meta.dir, "../../package.json");

function packageVersion(lockfilePath: string, name: string): string | undefined {
  const entry = new RegExp(`"${name}": \\[\\s*"${name}@([^"]+)"`);
  return entry.exec(readFileSync(lockfilePath, "utf8"))?.[1];
}

describe("seed-lockfile against the repo bun.lock", () => {
  let workDir: string;
  let cacheDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "seed-lockfile-"));
    cacheDir = mkdtempSync(join(tmpdir(), "seed-lockfile-cache-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  function bunInstall(args: readonly string[]): number {
    // Dead proxy: a dependency missing from the lock must fail instead of resolving from npm.
    const spawnEnv = {
      ...process.env,
      HTTPS_PROXY: "http://127.0.0.1:9",
      HTTP_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "",
      no_proxy: "",
      BUN_INSTALL_CACHE_DIR: cacheDir,
    };
    return Bun.spawnSync([process.execPath, "install", ...args], {
      cwd: workDir,
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode;
  }

  test("resolves offline from the seeded lock and keeps the locked versions", async () => {
    copyFileSync(SERVICE_MANIFEST, join(workDir, "package.json"));
    copyFileSync(REPO_LOCKFILE, join(workDir, "bun.lock"));
    await seedLockfileInDir(workDir);

    expect(bunInstall(["--lockfile-only"])).toBe(0);
    expect(bunInstall(["--production", "--frozen-lockfile", "--lockfile-only"])).toBe(0);

    const seeded = join(workDir, "bun.lock");
    for (const name of ["puppeteer", "ws"]) {
      const expected = packageVersion(REPO_LOCKFILE, name);
      expect(expected).toBeDefined();
      expect(packageVersion(seeded, name)).toBe(expected);
    }
  });
});
