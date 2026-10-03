import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRepoChecks } from "../_lib/guard-kit";
import { isRawSqlAllowed, scanRepo, sqlScanDirsFor } from "../_lib/sql-inventory";
import { check, collectRawSqlFindings } from "../guard-raw-sql";
import { fixtureRoot } from "./parent-workspace-fixture";

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "raw-sql-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("isRawSqlAllowed", () => {
  test("permits framework db/queries and bun-db/query", () => {
    expect(isRawSqlAllowed("/repo/packages/framework/src/db/queries/event-store.ts")).toBe(true);
    expect(isRawSqlAllowed("/repo/packages/framework/src/bun-db/query.ts")).toBe(true);
  });

  test("blocks handlers and feature production code", () => {
    expect(
      isRawSqlAllowed("/repo/packages/bundled-features/src/sessions/handlers/cleanup.job.ts"),
    ).toBe(false);
    expect(isRawSqlAllowed("/repo/packages/framework/src/pipeline/dispatcher.ts")).toBe(false);
  });

  test("permits codemod scripts and CLI commands", () => {
    expect(isRawSqlAllowed("/repo/scripts/codemod-drizzle-chain-to-bun-db.ts")).toBe(true);
    expect(isRawSqlAllowed("/repo/bin/commands/schema.ts")).toBe(true);
  });
});

describe("scanRepo — layout-aware scan dirs", () => {
  test("flat layout scans src/ and bin/, not packages/", async () => {
    const root = makeRepo({
      "src/feature.ts": 'await client.unsafe("SELECT 1");\n',
      "bin/backfill.ts": 'await client.unsafe("SELECT 1");\n',
      "packages/ignored/index.ts": 'await client.unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["src", "bin"]);
      expect(report.scannedFiles).toBe(2);
      expect(report.summary.disallowed).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("multi-package layout scans packages/samples/scripts/bin, not src/", async () => {
    const root = makeRepo({
      "packages/framework/src/x.ts": 'await client.unsafe("SELECT 1");\n',
      "src/ignored.ts": 'await client.unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["packages", "samples", "scripts", "bin"]);
      expect(report.scannedFiles).toBe(1);
      expect(report.summary.disallowed).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("unsafe pattern — generic-typed call form", () => {
  test("detects `.unsafe<{...}>(...)` alongside the untyped `.unsafe(...)`", async () => {
    const root = makeRepo({
      "src/x.ts":
        'await client.unsafe<{ id: string }>("SELECT 1");\n' +
        'await client.unsafe<{ a: Map<string, number> }>("SELECT 2");\n',
    });
    try {
      const report = await scanRepo(root, ["src", "bin"]);
      expect(report.summary.byKind.unsafe).toBe(2);
      expect(report.summary.disallowed).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("kumiko-lint-ignore raw-sql marker", () => {
  test("no marker → reported as disallowed", async () => {
    const root = makeRepo({
      "src/x.ts": 'await asRawClient(tx).unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["src", "bin"]);
      expect(report.summary.disallowed).toBeGreaterThan(0);
      expect(report.summary.byBucket.marker).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("marker with reason on the SAME line → suppressed", async () => {
    const root = makeRepo({
      "src/x.ts":
        'await asRawClient(tx).unsafe("SELECT 1"); // kumiko-lint-ignore raw-sql PII re-encryption\n',
    });
    try {
      const report = await scanRepo(root, ["src", "bin"]);
      expect(report.summary.disallowed).toBe(0);
      expect(report.summary.byBucket.marker).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("marker with reason on the line ABOVE → suppressed", async () => {
    const root = makeRepo({
      "src/x.ts":
        '// kumiko-lint-ignore raw-sql PII re-encryption, see #1263\nawait asRawClient(tx).unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["src", "bin"]);
      expect(report.summary.disallowed).toBe(0);
      expect(report.summary.byBucket.marker).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("bare marker WITHOUT a reason → still reported", async () => {
    const root = makeRepo({
      "src/x.ts": '// kumiko-lint-ignore raw-sql\nawait asRawClient(tx).unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["src", "bin"]);
      expect(report.summary.disallowed).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allowlisted path stays suppressed regardless of marker", async () => {
    const root = makeRepo({
      "packages/framework/src/db/queries/event-store.ts":
        'await asRawClient(tx).unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["packages", "samples", "scripts", "bin"]);
      expect(report.summary.byBucket.allowed).toBeGreaterThan(0);
      expect(report.summary.disallowed).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allowlisted path stays allowed even with a marker present", async () => {
    const root = makeRepo({
      "packages/framework/src/db/queries/event-store.ts":
        '// kumiko-lint-ignore raw-sql justified\nawait asRawClient(tx).unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["packages", "samples", "scripts", "bin"]);
      // Allowlist precedence: hit is "allowed", not "marker".
      expect(report.summary.byBucket.allowed).toBeGreaterThan(0);
      expect(report.summary.byBucket.marker).toBe(0);
      expect(report.summary.disallowed).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("/__tests__/ paths stay excluded regardless of marker", async () => {
    const root = makeRepo({
      "src/__tests__/x.ts": 'await asRawClient(tx).unsafe("SELECT 1");\n',
    });
    try {
      const report = await scanRepo(root, ["src", "bin"]);
      expect(report.summary.disallowed).toBe(0);
      expect(report.summary.byBucket.tests).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// The multi-repo "framework sibling checkout" fixture from infra doesn't
// apply to this single-repo package (resolveRepoRoots() only ever resolves
// the repo cwd sits in) — covered instead by deterministic tmp-repo
// RepoCheck fixtures below, at the same seam `kumiko check` (PR3) uses.
describe("check.run — RepoCheck seam", () => {
  test("kumiko-platform (sqlScanDirsFor === []) is skipped, not vacuous", async () => {
    const root = fixtureRoot("kumiko-platform", "/nonexistent", {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
    });
    const outcome = await check.run([root]);
    expect(outcome.notApplicable).toBe(true);
    expect(outcome.violations).toEqual([]);
  });

  test("an app repo whose declared source roots are all missing is vacuous, not skipped", async () => {
    const dir = makeRepo({ "unrelated/readme.txt": "x" });
    try {
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src", "bin"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.notApplicable).toBe(false);
      expect(outcome.matchedFiles).toBe(0);
      const [result] = await runRepoChecks([check], [root]);
      expect(result?.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unsafe() call outside the allowlist is a blocking violation", async () => {
    const dir = makeRepo({ "src/feature.ts": 'await client.unsafe("SELECT 1");\n' });
    try {
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.notApplicable).toBe(false);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe("src/feature.ts");
      expect(outcome.violations[0]?.message).toBe('[unsafe] await client.unsafe("SELECT 1");');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("wildcard source roots from the manifest expand to relative dirs and are scanned without explicit dirs", async () => {
    const dir = makeRepo({
      "packages/a/src/x.ts": "export const a = 1;\n",
      "packages/b/src/y.ts": "export const b = 1;\n",
      "bin/backfill.ts": 'await client.unsafe("SELECT 1");\n',
    });
    try {
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["packages/*/src", "bin", "missing/src"],
        testGlobs: ["**/*.test.ts"],
      });
      expect(sqlScanDirsFor(root)).toEqual(["bin", "packages/a/src", "packages/b/src"]);
      const outcome = await check.run([root]);
      expect(outcome.matchedFiles).toBe(3);
      expect(outcome.violations).toHaveLength(1);
      expect(outcome.violations[0]?.file).toBe("bin/backfill.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an allowlisted db/queries file scans clean", async () => {
    const dir = makeRepo({
      "src/db/queries/event-store.ts": 'await client.unsafe("SELECT 1");\n',
    });
    try {
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations).toEqual([]);
      expect(outcome.matchedFiles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("collectRawSqlFindings", () => {
  test("finds disallowed hits in a fixture repo", async () => {
    const dir = makeRepo({ "src/feature.ts": 'await asRawClient(tx).unsafe("SELECT 1");\n' });
    try {
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const findings = await collectRawSqlFindings([root]);
      // asRawClient(...) and .unsafe(...) on the same line are 2 distinct pattern hits.
      expect(findings).toHaveLength(2);
      expect(findings.every((f) => f.repo === "app-repo")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("raw-sql marker baseline", () => {
  const BASELINE = ".kumiko-raw-sql-baseline.json";
  const MARKED =
    '// kumiko-lint-ignore raw-sql needs FOR UPDATE\nawait client.unsafe("SELECT 1");\n';

  function withRepo(
    files: Record<string, string>,
    baseline: Record<string, number> | undefined,
    body: (root: ReturnType<typeof fixtureRoot>, dir: string) => Promise<void>,
  ): Promise<void> {
    const dir = makeRepo(files);
    if (baseline !== undefined) {
      writeFileSync(
        join(dir, BASELINE),
        JSON.stringify({ format: 1, generated: "2026-01-01", total: 0, perFile: baseline }),
      );
    }
    const root = fixtureRoot("app-repo", dir, {
      kind: "app",
      sourceRoots: ["src"],
      testGlobs: ["src/**/*.test.ts"],
    });
    return body(root, dir).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  test("no baseline file → no violation, a warning is printed", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await withRepo({ "src/x.ts": MARKED }, undefined, async (root) => {
        const outcome = await check.run([root]);
        expect(outcome.violations).toEqual([]);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No baseline found"));
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test("baseline present but marker missing from it → violation at the marker line", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await withRepo({ "src/x.ts": MARKED }, {}, async (root) => {
        const outcome = await check.run([root]);
        expect(outcome.violations).toHaveLength(1);
        expect(outcome.violations[0]?.line).toBe(1);
        expect(outcome.violations[0]?.message).toContain("raw-sql marker(s) over baseline");
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test("matching (file, reason) in the baseline → ok", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await withRepo({ "src/x.ts": MARKED }, { "src/x.ts::needs FOR UPDATE": 1 }, async (root) => {
        expect((await check.run([root])).violations).toEqual([]);
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test("same file with a reworded reason → violation", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await withRepo({ "src/x.ts": MARKED }, { "src/x.ts::other reason": 1 }, async (root) => {
        expect((await check.run([root])).violations).toHaveLength(1);
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test("a line with asRawClient(db).unsafe( plus marker counts once", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await withRepo(
        {
          "src/x.ts":
            '// kumiko-lint-ignore raw-sql needs FOR UPDATE\nawait asRawClient(db).unsafe("SELECT 1");\n',
        },
        { "src/x.ts::needs FOR UPDATE": 1 },
        async (root) => {
          expect((await check.run([root])).violations).toEqual([]);
        },
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  test("markers in allowlisted paths and __tests__ are not counted", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await withRepo(
        {
          "src/db/queries/q.ts": MARKED,
          "src/__tests__/t.ts": MARKED,
          "src/ok.ts": "export const a = 1;\n",
        },
        {},
        async (root) => {
          expect((await check.run([root])).violations).toEqual([]);
        },
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  test("writeBaseline freezes the current markers", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await withRepo({ "src/x.ts": MARKED }, undefined, async (root, dir) => {
        await check.writeBaseline?.([root]);
        expect(existsSync(join(dir, BASELINE))).toBe(true);
        const written = JSON.parse(readFileSync(join(dir, BASELINE), "utf-8"));
        expect(written.perFile).toEqual({ "src/x.ts::needs FOR UPDATE": 1 });
        expect((await check.run([root])).violations).toEqual([]);
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});
