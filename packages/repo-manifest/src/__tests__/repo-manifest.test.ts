import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadRepoManifest,
  REPO_MANIFEST_FILE,
  type RepoManifest,
  RepoManifestError,
} from "../index";

function writeManifest(root: string, manifest: unknown): void {
  writeFileSync(join(root, REPO_MANIFEST_FILE), JSON.stringify(manifest), "utf8");
}

function writeRaw(root: string, raw: string): void {
  writeFileSync(join(root, REPO_MANIFEST_FILE), raw, "utf8");
}

function expectErrorIncludes(root: string, ...fragments: string[]): void {
  try {
    loadRepoManifest(root);
  } catch (error) {
    if (!(error instanceof RepoManifestError)) throw error;
    for (const fragment of fragments) {
      expect(error.message).toContain(fragment);
    }
    return;
  }
  throw new Error("expected loadRepoManifest to throw a RepoManifestError");
}

const VALID_MANIFEST: RepoManifest = {
  kind: "library",
  sourceRoots: ["packages/*/src"],
  testGlobs: ["packages/*/src/**/*.{test,integration}.{ts,tsx}"],
  uiRoots: ["packages/*/src/**/web"],
  excludes: ["**/node_modules/**"],
};

describe("loadRepoManifest", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kumiko-repo-manifest-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("loads a valid manifest file", () => {
    writeManifest(root, VALID_MANIFEST);
    let warned = false;
    const result = loadRepoManifest(root, { warn: () => (warned = true) });
    expect(result.source).toBe("file");
    expect(result.manifest).toEqual(VALID_MANIFEST);
    expect(result.manifestPath).toBe(join(root, REPO_MANIFEST_FILE));
    expect(warned).toBe(false);
  });

  test("missing sourceRoots is rejected", () => {
    writeManifest(root, { kind: "app", testGlobs: ["src/**/*.test.ts"] });
    expectErrorIncludes(root, join(root, REPO_MANIFEST_FILE), "sourceRoots");
  });

  test("missing kind is rejected", () => {
    writeManifest(root, { sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] });
    expectErrorIncludes(root, "kind");
  });

  test("invalid kind is rejected", () => {
    writeManifest(root, {
      kind: "enterprise",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
    });
    expectErrorIncludes(root, "kind");
  });

  test("empty sourceRoots array is rejected", () => {
    writeManifest(root, { kind: "app", sourceRoots: [], testGlobs: ["src/**/*.test.ts"] });
    expectErrorIncludes(root, "sourceRoots");
  });

  test("unknown field is rejected (strict)", () => {
    writeManifest(root, {
      kind: "app",
      sourceRoot: ["src"],
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
    });
    expectErrorIncludes(root, "sourceRoot");
  });

  test.each([
    ["/etc", "must be relative"],
    ["C:/x", "must be relative"],
    ["src\\a", "backslashes"],
  ])("rejects unsafe pattern %s", (unsafe, fragment) => {
    writeManifest(root, { kind: "app", sourceRoots: [unsafe], testGlobs: ["src/**/*.test.ts"] });
    expectErrorIncludes(root, fragment);
  });

  test.each([["../other/src"], ["packages/../../x"]])(
    "rejects traversal pattern %s in sourceRoots",
    (unsafe) => {
      writeManifest(root, { kind: "app", sourceRoots: [unsafe], testGlobs: ["src/**/*.test.ts"] });
      expectErrorIncludes(root, "must not traverse");
    },
  );

  test("rejects traversal pattern in uiRoots", () => {
    writeManifest(root, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
      uiRoots: ["../outside"],
    });
    expectErrorIncludes(root, "must not traverse");
  });

  test("rejects traversal pattern in excludes", () => {
    writeManifest(root, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
      excludes: ["packages/../../x"],
    });
    expectErrorIncludes(root, "must not traverse");
  });

  test("rejects leading ! in excludes", () => {
    writeManifest(root, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
      excludes: ["!src/keep"],
    });
    expectErrorIncludes(root, "must not start with");
  });

  test("rejects a sourceRoots pattern that symlinks outside the repo root", () => {
    const outside = mkdtempSync(join(tmpdir(), "kumiko-repo-manifest-outside-"));
    try {
      mkdirSync(join(outside, "src"));
      symlinkSync(join(outside, "src"), join(root, "linked"));
      writeManifest(root, {
        kind: "app",
        sourceRoots: ["linked/src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      expectErrorIncludes(root, "resolves outside the repo root");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects a kumiko.json that is a symlink to a file outside the repo root", () => {
    const outside = mkdtempSync(join(tmpdir(), "kumiko-repo-manifest-outside-"));
    try {
      const outsideManifest = join(outside, "external.json");
      writeFileSync(outsideManifest, JSON.stringify(VALID_MANIFEST), "utf8");
      symlinkSync(outsideManifest, join(root, REPO_MANIFEST_FILE));
      expectErrorIncludes(root, "resolves outside the repo root");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("accepts a symlink that stays inside the repo root", () => {
    mkdirSync(join(root, "actual", "src"), { recursive: true });
    symlinkSync(join(root, "actual"), join(root, "linked-in"));
    writeManifest(root, {
      kind: "app",
      sourceRoots: ["linked-in/src"],
      testGlobs: ["src/**/*.test.ts"],
    });
    const result = loadRepoManifest(root);
    expect(result.source).toBe("file");
  });

  test("derives a library layout from packages/*/src", () => {
    mkdirSync(join(root, "packages", "a", "src"), { recursive: true });
    const warnings: string[] = [];
    const result = loadRepoManifest(root, { warn: (message) => warnings.push(message) });
    expect(result.source).toBe("derived");
    expect(result.manifest.kind).toBe("library");
    expect(result.manifest.sourceRoots).toEqual(["packages/*/src"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(REPO_MANIFEST_FILE);
  });

  test("derives an app layout from src/", () => {
    mkdirSync(join(root, "src"), { recursive: true });
    const warnings: string[] = [];
    const result = loadRepoManifest(root, { warn: (message) => warnings.push(message) });
    expect(result.source).toBe("derived");
    expect(result.manifest.kind).toBe("app");
    expect(result.manifest.sourceRoots).toEqual(["src"]);
    expect(warnings).toHaveLength(1);
  });

  test("throws when neither a manifest nor a derivable layout exists", () => {
    expectErrorIncludes(root, "not found and no");
  });

  test("broken JSON is rejected with the manifest path in the message", () => {
    writeRaw(root, "{ not json");
    expectErrorIncludes(root, join(root, REPO_MANIFEST_FILE));
  });

  test("a non-existent root is rejected", () => {
    expectErrorIncludes(join(root, "does-not-exist"), "does not exist");
  });

  test("loads this repo's own kumiko.json", () => {
    const repoRoot = resolve(import.meta.dir, "../../../..");
    let warned = false;
    const result = loadRepoManifest(repoRoot, { warn: () => (warned = true) });
    expect(result.source).toBe("file");
    expect(result.manifest.kind).toBe("framework");
    expect(warned).toBe(false);
  });
});
