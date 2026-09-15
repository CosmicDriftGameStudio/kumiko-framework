import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRepoManifest,
  type RepoManifest,
  RepoManifestError,
} from "@cosmicdrift/kumiko-repo-manifest";
import { Project } from "ts-morph";
import { type AstGuard, checkRootFloor, runGuards } from "../_lib/guard-kit";
import { findLocalRepo, type RepoRoot } from "../_lib/roots";
import { type ScanSpec, scanFiles, scanRoots } from "../_lib/scan-scope";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFile(path: string, content = "export {};\n"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function writeManifest(dir: string, manifest: RepoManifest): void {
  writeFileSync(join(dir, "kumiko.json"), JSON.stringify(manifest, null, 2), "utf-8");
}

/** Builds a RepoRoot straight from a real on-disk manifest — no package.json/repo-marker gate, just what scan-scope itself needs. */
function rootAt(name: string, absPath: string): RepoRoot {
  const loaded = loadRepoManifest(absPath);
  return {
    name,
    absPath,
    kind: loaded.manifest.kind,
    manifest: loaded.manifest,
    manifestSource: loaded.source,
  };
}

describe("scanRoots/scanFiles — framework layout with excludes + frameworkWithin (a)", () => {
  test("packages/*/src + samples are scanned, node_modules excluded, frameworkWithin narrows", () => {
    const dir = tmpDir("scan-scope-fw-");
    writeManifest(dir, {
      kind: "framework",
      sourceRoots: ["packages/*/src", "samples"],
      testGlobs: ["packages/*/src/**/*.{test,integration}.{ts,tsx}"],
      excludes: ["**/node_modules/**"],
    });
    writeFile(join(dir, "packages/pkgA/src/index.ts"));
    writeFile(join(dir, "packages/pkgA/src/node_modules/dep/index.ts"));
    writeFile(join(dir, "samples/demo/app.ts"));
    const root = rootAt("kumiko-framework", dir);

    const spec: ScanSpec = { scope: "source", extensions: ["ts"] };
    const files = scanFiles(spec, [root]);
    expect(files).toEqual(
      [join(dir, "packages/pkgA/src/index.ts"), join(dir, "samples/demo/app.ts")].sort(),
    );

    const narrowed: ScanSpec = {
      scope: "source",
      extensions: ["ts"],
      frameworkWithin: ["packages/pkgA/**"],
    };
    expect(scanFiles(narrowed, [root])).toEqual([join(dir, "packages/pkgA/src/index.ts")]);
  });
});

describe("scanRoots/scanFiles — flat app without manifest, within narrows sourceRoot-relative (b)", () => {
  test("derives src/ as the sole sourceRoot; within matches relative to src/", () => {
    const dir = tmpDir("scan-scope-app-");
    writeFile(join(dir, "src/features/t/web/screen.tsx"));
    writeFile(join(dir, "src/lib/util.ts"));
    const loaded = loadRepoManifest(dir);
    expect(loaded.source).toBe("derived");
    expect(loaded.manifest.kind).toBe("app");
    const root: RepoRoot = {
      name: "brand-new-app",
      absPath: dir,
      kind: loaded.manifest.kind,
      manifest: loaded.manifest,
      manifestSource: loaded.source,
    };

    const spec: ScanSpec = { scope: "source", extensions: ["ts", "tsx"], within: ["**/web/**"] };
    expect(scanFiles(spec, [root])).toEqual([join(dir, "src/features/t/web/screen.tsx")]);
  });
});

describe("scanRoots/scanFiles — multi-package without manifest, within relative to packages/x/src (c)", () => {
  test("derives packages/*/src as the sourceRoot; within matches relative to each package's src", () => {
    const dir = tmpDir("scan-scope-lib-");
    writeFile(join(dir, "packages/designer/src/features/t/web/screen.tsx"));
    writeFile(join(dir, "packages/designer/src/lib/util.ts"));
    const loaded = loadRepoManifest(dir);
    expect(loaded.source).toBe("derived");
    expect(loaded.manifest.kind).toBe("library");
    const root: RepoRoot = {
      name: "kumiko-enterprise",
      absPath: dir,
      kind: loaded.manifest.kind,
      manifest: loaded.manifest,
      manifestSource: loaded.source,
    };

    const spec: ScanSpec = { scope: "source", extensions: ["ts", "tsx"], within: ["**/web/**"] };
    expect(scanFiles(spec, [root])).toEqual([
      join(dir, "packages/designer/src/features/t/web/screen.tsx"),
    ]);
  });
});

describe("scanRoots/scanFiles — tests scope uses testGlobs + extension filter (d)", () => {
  test("only testGlobs hits of the requested extensions are returned", () => {
    const dir = tmpDir("scan-scope-tests-");
    writeManifest(dir, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
    });
    writeFile(join(dir, "src/a.ts"));
    writeFile(join(dir, "src/a.test.ts"));
    writeFile(join(dir, "src/a.test.tsx"));
    writeFile(join(dir, "src/a.integration.ts"));
    const root = rootAt("money-horse", dir);

    const tsOnly: ScanSpec = { scope: "tests", extensions: ["ts"] };
    expect(scanFiles(tsOnly, [root])).toEqual(
      [join(dir, "src/a.integration.ts"), join(dir, "src/a.test.ts")].sort(),
    );

    const both: ScanSpec = { scope: "tests", extensions: ["ts", "tsx"] };
    expect(scanFiles(both, [root])).toEqual(
      [
        join(dir, "src/a.integration.ts"),
        join(dir, "src/a.test.ts"),
        join(dir, "src/a.test.tsx"),
      ].sort(),
    );
  });
});

describe("kumiko.json with a path escaping the repo root (e)", () => {
  test("resolution throws RepoManifestError instead of silently accepting it", () => {
    const dir = tmpDir("scan-scope-invalid-");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "bad-manifest-repo" }),
      "utf-8",
    );
    writeManifest(dir, {
      kind: "app",
      sourceRoots: ["../x"],
      testGlobs: ["src/**/*.test.ts"],
    } as unknown as RepoManifest);

    expect(() => findLocalRepo(dir)).toThrow(RepoManifestError);
  });
});

describe("symlink escapes are never scanned (f)", () => {
  test("a symlinked directory inside src pointing outside the root is not scanned", () => {
    const dir = tmpDir("scan-scope-symdir-");
    const outside = tmpDir("scan-scope-outside-");
    writeFile(join(outside, "secret.ts"));
    writeManifest(dir, { kind: "app", sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] });
    writeFile(join(dir, "src/kept.ts"));
    mkdirSync(join(dir, "src"), { recursive: true });
    symlinkSync(outside, join(dir, "src", "linked-dir"));
    const root = rootAt("brand-new-app", dir);

    const spec: ScanSpec = { scope: "source", extensions: ["ts"] };
    expect(scanFiles(spec, [root])).toEqual([join(dir, "src/kept.ts")]);
  });

  test("a symlinked file inside src pointing outside the root is not scanned", () => {
    const dir = tmpDir("scan-scope-symfile-");
    const outside = tmpDir("scan-scope-outside-");
    writeFile(join(outside, "secret.ts"));
    writeManifest(dir, { kind: "app", sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] });
    writeFile(join(dir, "src/kept.ts"));
    symlinkSync(join(outside, "secret.ts"), join(dir, "src", "linked.ts"));
    const root = rootAt("brand-new-app", dir);

    const spec: ScanSpec = { scope: "source", extensions: ["ts"] };
    expect(scanFiles(spec, [root])).toEqual([join(dir, "src/kept.ts")]);
  });
});

describe("kinds filter excludes roots (g)", () => {
  test("a root whose kind is not in spec.kinds is dropped entirely, not just narrowed", () => {
    const appDir = tmpDir("scan-scope-kindsapp-");
    writeFile(join(appDir, "src/a.ts"));
    const libDir = tmpDir("scan-scope-kindslib-");
    writeFile(join(libDir, "packages/x/src/a.ts"));
    const appRoot = rootAt("app-repo", appDir);
    const libRoot = rootAt("lib-repo", libDir);

    const spec: ScanSpec = { scope: "source", extensions: ["ts"], kinds: ["library"] };
    const scans = scanRoots(spec, [appRoot, libRoot]);
    expect(scans.map((s) => s.root.name)).toEqual(["lib-repo"]);
  });
});

describe("D4 floor — a root with declared sourceRoots but no .ts/.tsx (h)", () => {
  test("checkRootFloor names the root, runGuards fails with violatingRoots", () => {
    const dir = tmpDir("scan-scope-empty-");
    writeManifest(dir, { kind: "app", sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "README.md"), "no source here\n", "utf-8");
    const root = rootAt("empty-app", dir);

    const guard: AstGuard = {
      name: "floor-guard",
      scan: { scope: "source", extensions: ["ts"] },
      run: () => ({ violations: [] }),
    };
    const scans = scanRoots(guard.scan, [root]);
    expect(scans[0]?.sourceSurface).toBe(0);
    expect(checkRootFloor(guard, scans).violatingRoots).toEqual(["empty-app"]);

    const [result] = runGuards([guard], new Project({ useInMemoryFileSystem: true }), {
      roots: [root],
    });
    expect(result?.ok).toBe(false);
    expect(result?.violatingRoots).toEqual(["empty-app"]);
  });

  test("tests scope has no comparable floor", () => {
    const dir = tmpDir("scan-scope-notests-");
    writeManifest(dir, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
    });
    writeFile(join(dir, "src/a.ts"));
    const root = rootAt("no-tests-app", dir);
    const guard: AstGuard = {
      name: "tests-floor-guard",
      scan: { scope: "tests", extensions: ["ts"] },
      run: () => ({ violations: [] }),
    };
    const scans = scanRoots(guard.scan, [root]);
    expect(checkRootFloor(guard, scans).violatingRoots).toEqual([]);
  });
});
