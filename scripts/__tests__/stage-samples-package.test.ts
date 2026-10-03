import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clean, isShippedSamplePath, stage } from "../stage-samples-package";

describe("isShippedSamplePath", () => {
  test("accepts feature sources and package manifests", () => {
    expect(isShippedSamplePath("packages/bundled-features/src/audit-log/feature.ts")).toBe(true);
    expect(isShippedSamplePath("packages/bundled-features/package.json")).toBe(true);
    expect(isShippedSamplePath("samples/recipes/basic-entity/package.json")).toBe(true);
  });

  test("rejects env files and dot directories", () => {
    expect(isShippedSamplePath("samples/apps/demo/.env.local")).toBe(false);
    expect(isShippedSamplePath("samples/recipes/state-machine/.kumiko/types.ts")).toBe(false);
  });

  test("rejects tests, build output and dependency trees", () => {
    expect(isShippedSamplePath("packages/bundled-features/src/x/__tests__/feature.ts")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/src/a.test.ts")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/e2e/flow.ts")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/node_modules/x/index.ts")).toBe(false);
  });

  test("rejects traversal, absolute paths and non-source extensions", () => {
    expect(isShippedSamplePath("../outside/feature.ts")).toBe(false);
    expect(isShippedSamplePath("samples/../../x.ts")).toBe(false);
    expect(isShippedSamplePath("/etc/passwd.json")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/logo.png")).toBe(false);
  });
});

describe("stage and clean on the checked-in symlink layout", () => {
  const entries = [
    "samples/recipes",
    "samples/apps",
    "packages/bundled-features/src",
    "packages/bundled-features/package.json",
  ];
  let repoRoot: string;
  let packageDir: string;

  function write(relativePath: string, content: string): void {
    const full = join(repoRoot, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  function git(...args: string[]): void {
    const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  }

  beforeEach(() => {
    repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "stage-samples-")));
    packageDir = join(repoRoot, "packages", "samples");
    mkdirSync(packageDir, { recursive: true });
    write("samples/recipes/basic/package.json", "{}");
    write("samples/recipes/basic/src/a.test.ts", "export {};");
    write("samples/apps/demo/src/main.ts", "export {};");
    write("packages/bundled-features/package.json", "{}");
    write("packages/bundled-features/src/audit/feature.ts", "export {};");
    git("init", "-q");
    git("add", ".");
    clean({ repoRoot, packageDir });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("clean restores the relative symlinks into the repo", () => {
    for (const entry of entries) {
      const link = join(packageDir, entry);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link).startsWith("../")).toBe(true);
      expect(realpathSync(link)).toBe(join(repoRoot, entry));
    }
  });

  test("stage swaps the symlinks for filtered real files", () => {
    stage({ repoRoot, packageDir });
    for (const entry of entries) {
      expect(lstatSync(join(packageDir, entry)).isSymbolicLink()).toBe(false);
    }
    expect(readFileSync(join(packageDir, "samples/recipes/basic/package.json"), "utf8")).toBe("{}");
    expect(lstatSync(join(packageDir, "samples/apps/demo/src/main.ts")).isFile()).toBe(true);
    expect(existsSync(join(packageDir, "samples/recipes/basic/src/a.test.ts"))).toBe(false);
  });

  test("stage then clean leaves the symlink layout and the repo sources untouched", () => {
    stage({ repoRoot, packageDir });
    clean({ repoRoot, packageDir });
    for (const entry of entries) {
      expect(lstatSync(join(packageDir, entry)).isSymbolicLink()).toBe(true);
    }
    expect(existsSync(join(repoRoot, "samples/recipes/basic/src/a.test.ts"))).toBe(true);
  });
});
