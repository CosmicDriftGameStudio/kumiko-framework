import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as z from "zod";
import { writeServerLockfile } from "../write-server-lockfile.ts";

const REPO_LOCKFILE = resolve(import.meta.dir, "../../../../bun.lock");
const LOCKED_PACKAGE = "escape-string-regexp";

function lockedVersionOf(lockfilePath: string): string | undefined {
  const entry = new RegExp(`"${LOCKED_PACKAGE}": \\["${LOCKED_PACKAGE}@([^"]+)"`);
  return entry.exec(readFileSync(lockfilePath, "utf8"))?.[1];
}

function readJsonc(path: string): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(Bun.JSONC.parse(readFileSync(path, "utf8")));
}

function frozenLockfileCheck(outDir: string): number {
  return Bun.spawnSync(
    [process.execPath, "install", "--production", "--frozen-lockfile", "--lockfile-only"],
    { cwd: outDir, env: process.env, stdout: "pipe", stderr: "pipe" },
  ).exitCode;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("writeServerLockfile", () => {
  let appDir = "";
  let outDir = "";

  beforeEach(() => {
    appDir = mkdtempSync(join(tmpdir(), "kumiko-server-lock-"));
    outDir = join(appDir, "dist-server");
    mkdirSync(outDir, { recursive: true });
    // An open range: a fresh resolve picks the newest release, the seed pins the locked one.
    writeFileSync(
      join(outDir, "package.json"),
      JSON.stringify({
        name: "server-lock-fixture-runtime",
        private: true,
        dependencies: { [LOCKED_PACKAGE]: ">=2.0.0" },
      }),
    );
  });

  afterEach(() => {
    rmSync(appDir, { recursive: true, force: true });
  });

  test("seeds from the nearest app bun.lock and keeps its locked versions", async () => {
    const seedVersion = lockedVersionOf(REPO_LOCKFILE);
    expect(seedVersion).toBeDefined();
    copyFileSync(REPO_LOCKFILE, join(appDir, "bun.lock"));
    const appCwd = join(appDir, "apps", "demo");
    mkdirSync(appCwd, { recursive: true });

    const result = await writeServerLockfile({ cwd: appCwd, outDir });

    expect(result).toEqual({
      mode: "seeded",
      seedLockfile: join(appDir, "bun.lock"),
      lockfile: join(outDir, "bun.lock"),
    });
    expect(lockedVersionOf(join(outDir, "bun.lock"))).toBe(seedVersion);
    expect(frozenLockfileCheck(outDir)).toBe(0);
  });

  test("resolves the server lock without network when the seed lock carries every runtime dependency", async () => {
    const seedVersion = lockedVersionOf(REPO_LOCKFILE);
    expect(seedVersion).toBeDefined();
    copyFileSync(REPO_LOCKFILE, join(appDir, "bun.lock"));
    const emptyCache = mkdtempSync(join(tmpdir(), "kumiko-empty-bun-cache-"));
    const saved = {
      cache: process.env["BUN_INSTALL_CACHE_DIR"],
      https: process.env["HTTPS_PROXY"],
      http: process.env["HTTP_PROXY"],
      noProxy: process.env["NO_PROXY"],
      noProxyLower: process.env["no_proxy"],
    };
    process.env["BUN_INSTALL_CACHE_DIR"] = emptyCache;
    process.env["HTTPS_PROXY"] = "http://127.0.0.1:9";
    process.env["HTTP_PROXY"] = "http://127.0.0.1:9";
    process.env["NO_PROXY"] = "";
    process.env["no_proxy"] = "";
    try {
      const result = await writeServerLockfile({ cwd: appDir, outDir });

      expect(result.mode).toBe("seeded");
      expect(lockedVersionOf(join(outDir, "bun.lock"))).toBe(seedVersion);
      expect(frozenLockfileCheck(outDir)).toBe(0);
      const seedOverrides = readJsonc(REPO_LOCKFILE)["overrides"];
      expect(seedOverrides).toBeDefined();
      expect(readJsonc(join(outDir, "package.json"))["overrides"]).toEqual(seedOverrides);
      expect(readJsonc(join(outDir, "bun.lock"))["overrides"]).toEqual(seedOverrides);
    } finally {
      restoreEnv("BUN_INSTALL_CACHE_DIR", saved.cache);
      restoreEnv("HTTPS_PROXY", saved.https);
      restoreEnv("HTTP_PROXY", saved.http);
      restoreEnv("NO_PROXY", saved.noProxy);
      restoreEnv("no_proxy", saved.noProxyLower);
      rmSync(emptyCache, { recursive: true, force: true });
    }
  });

  test("resolves fresh when no bun.lock exists above the app", async () => {
    const result = await writeServerLockfile({ cwd: appDir, outDir });

    expect(result).toEqual({ mode: "resolved", lockfile: join(outDir, "bun.lock") });
    expect(existsSync(join(outDir, "bun.lock"))).toBe(true);
    // Proves the open range really moves without a seed, so the seeded case above pins something.
    expect(lockedVersionOf(join(outDir, "bun.lock"))).not.toBe(lockedVersionOf(REPO_LOCKFILE));
    expect(frozenLockfileCheck(outDir)).toBe(0);
  });

  test("fails with the install error when the bundle package.json cannot be resolved", async () => {
    writeFileSync(
      join(outDir, "package.json"),
      JSON.stringify({
        name: "server-lock-fixture-runtime",
        private: true,
        dependencies: { "kumiko-nonexistent-package-for-lockfile-test": "^1.0.0" },
      }),
    );

    await expect(writeServerLockfile({ cwd: appDir, outDir })).rejects.toThrow(
      /bun install --lockfile-only failed/,
    );
  });
});
