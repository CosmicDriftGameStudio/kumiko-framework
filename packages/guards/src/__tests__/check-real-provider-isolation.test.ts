import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../check-real-provider-isolation";
import { fixtureRoot } from "./parent-workspace-fixture";

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "real-provider-isolation-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("Real-Provider-Isolation Guard (check.run)", () => {
  test("flags a CI workflow that sets KUMIKO_REAL_PROVIDERS", async () => {
    const root = makeRepo({
      ".github/workflows/ci.yml": "env:\n  KUMIKO_REAL_PROVIDERS: 1\njobs: {}\n",
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe(".github/workflows/ci.yml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags a CI workflow invoking test:real", async () => {
    const root = makeRepo({
      ".github/workflows/ci.yml": "      - run: bun run test:real\n",
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not flag a clean CI workflow", async () => {
    const root = makeRepo({
      ".github/workflows/ci.yml": "jobs:\n  test:\n    steps:\n      - run: bun test\n",
      "package.json": JSON.stringify({ name: "fixture-app", scripts: { test: "bun test" } }),
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags a package.json script outside test:real/e2e:real that sets the real-provider env", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({
        name: "fixture-app",
        scripts: {
          ci: "KUMIKO_REAL_PROVIDERS=1 bun test",
          "test:real": "KUMIKO_REAL_PROVIDERS=1 bun --config=bunfig.real.toml test real.test.ts",
        },
      }),
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.message).toContain('script "ci"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags an app bunfig.toml missing the *.real.test.ts exclusion", async () => {
    const root = makeRepo({
      "bunfig.toml": '[test]\npathIgnorePatterns = ["**/*.integration.test.ts"]\n',
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe("bunfig.toml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not flag bunfig.real.toml itself for lacking the exclusion (it targets .real. files)", async () => {
    const root = makeRepo({
      "bunfig.real.toml": '[test]\npathIgnorePatterns = ["**/*.integration.test.ts"]\n',
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not flag a repo-specific bunfig outside the template's own set (e.g. a coverage-ratchet config)", async () => {
    const root = makeRepo({
      "bunfig.coverage.toml": '[test]\ncoveragePathIgnorePatterns = ["**/node_modules/**"]\n',
    });
    try {
      const repoRoot = fixtureRoot("fixture-app", root, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not flag a framework repo's own bunfig.toml (framework doesn't consume its own scaffold)", async () => {
    const root = makeRepo({
      "bunfig.toml": '[test]\npathIgnorePatterns = ["**/*.integration.test.ts"]\n',
    });
    try {
      const repoRoot = fixtureRoot("fixture-framework", root, {
        kind: "framework",
        sourceRoots: ["packages/*/src"],
        testGlobs: ["packages/*/src/**/*.test.ts"],
      });
      const outcome = await check.run([repoRoot]);
      expect(outcome.violations).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is not applicable when no roots are resolved", async () => {
    const outcome = await check.run([]);
    expect(outcome.notApplicable).toBe(true);
    expect(outcome.violations).toEqual([]);
  });
});
