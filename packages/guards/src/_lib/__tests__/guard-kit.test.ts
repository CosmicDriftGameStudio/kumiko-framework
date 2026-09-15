import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoKind } from "@cosmicdrift/kumiko-repo-manifest";
import { Project } from "ts-morph";
import {
  type AstGuard,
  checkRootFloor,
  explainGuards,
  reportResults,
  runGuards,
} from "../guard-kit";
import type { RepoRoot } from "../roots";
import type { RootScan, ScanSpec } from "../scan-scope";
import type { SecurityBaselineLoad } from "../security-baseline";

// In-memory project keeps the test hermetic: buildSharedProject() would need the
// framework tsconfig, absent in a standalone repo checkout.
const emptyProject = () => new Project({ useInMemoryFileSystem: true });

const SOURCE_SPEC: ScanSpec = { scope: "source", extensions: ["ts"] };

function repoRoot(name: string, absPath: string, kind: RepoKind = "app"): RepoRoot {
  return {
    name,
    absPath,
    kind,
    manifest: { kind, sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] },
    manifestSource: "derived",
  };
}

function rootScan(root: RepoRoot, files: readonly string[], sourceSurface: number): RootScan {
  return { root, files, sourceSurface };
}

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A real directory with a real .ts file — locateFinding() (security baseline) needs existsSync to succeed. */
function rootWithSourceFile(name: string): RepoRoot {
  const absPath = mkdtempSync(join(tmpdir(), "guard-kit-root-"));
  tmpDirs.push(absPath);
  mkdirSync(join(absPath, "src"), { recursive: true });
  writeFileSync(join(absPath, "src/present.ts"), "export const x = 1;\n");
  return repoRoot(name, absPath);
}

/** Injects a fixed answer for `deps.scan`/`deps.resolution.scan`, independent of which roots are passed in. */
function fixedScan(
  scans: readonly RootScan[],
): (guard: AstGuard, roots: readonly RepoRoot[]) => readonly RootScan[] {
  return () => scans;
}

const okGuard: AstGuard = {
  name: "ok-guard",
  scan: SOURCE_SPEC,
  run: () => ({ violations: [] }),
};

const throwingGuard: AstGuard = {
  name: "throwing-guard",
  scan: SOURCE_SPEC,
  run: () => {
    throw new Error("boom");
  },
};

function captureConsole(fn: () => void): string {
  const lines: string[] = [];
  const { log, error } = console;
  const collect = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  };
  console.log = collect;
  console.error = collect;
  try {
    fn();
  } finally {
    console.log = log;
    console.error = error;
  }
  return lines.join("\n");
}

describe("runGuards — a throwing guard fails closed instead of crashing the run", () => {
  test("the throw is captured as ok:false with the error; sibling guards still run", () => {
    const results = runGuards([throwingGuard, okGuard], emptyProject(), {
      roots: [],
      scan: fixedScan([]),
    });
    const thrown = results.find((r) => r.name === "throwing-guard");
    const ok = results.find((r) => r.name === "ok-guard");
    expect(thrown?.ok).toBe(false);
    expect(thrown?.error).toContain("boom");
    // the in-process model means one guard's throw must not take the others down.
    expect(ok?.error).toBeUndefined();
    expect(ok?.outcome).toBeDefined();
  });
});

// The three verdicts decide whether a guard reporting "no violations" is
// believed. `deps.scan` is injected so each verdict is reproducible without a real checkout.
describe("runGuards — vacuity verdicts", () => {
  test("no roots scanned → notApplicable, and the guard still passes", () => {
    const [result] = runGuards([okGuard], emptyProject(), {
      roots: [],
      scan: fixedScan([]),
    });
    expect(result?.notApplicable).toBe(true);
    expect(result?.ok).toBe(true);
    expect(result?.matchedFiles).toBe(0);
  });

  test("a root resolved but narrowed to 0 files, with real source surface → legitimate emptiness, guard passes", () => {
    const root = repoRoot("solon", "/repo/solon");
    const [result] = runGuards([okGuard], emptyProject(), {
      roots: [root],
      scan: fixedScan([rootScan(root, [], 3)]),
    });
    expect(result?.notApplicable).toBe(false);
    expect(result?.violatingRoots).toBeUndefined();
    expect(result?.ok).toBe(true);
    expect(result?.matchedFiles).toBe(0);
  });

  test("a scan matched files → normal run, guard passes and reports the count", () => {
    const project = emptyProject();
    project.createSourceFile("/repo/src/a.ts", "export const a = 1;");
    project.createSourceFile("/repo/src/b.ts", "export const b = 2;");
    const root = repoRoot("solon", "/repo");
    const seen: number[] = [];
    const countingGuard: AstGuard = {
      name: "counting-guard",
      scan: SOURCE_SPEC,
      run: (files) => {
        seen.push(files.length);
        return { violations: [] };
      },
    };
    const [result] = runGuards([countingGuard], project, {
      roots: [root],
      scan: fixedScan([rootScan(root, ["/repo/src/a.ts", "/repo/src/b.ts"], 2)]),
    });
    expect(seen).toEqual([2]);
    expect(result?.ok).toBe(true);
    expect(result?.matchedFiles).toBe(2);
  });

  test("violations → guard fails even though the scan was healthy", () => {
    const project = emptyProject();
    project.createSourceFile("/repo/src/a.ts", "export const a = 1;");
    const root = repoRoot("solon", "/repo");
    const violatingGuard: AstGuard = {
      name: "violating-guard",
      scan: SOURCE_SPEC,
      run: () => ({
        violations: [{ file: "/repo/src/a.ts", line: 1, message: "nope" }],
      }),
    };
    const [result] = runGuards([violatingGuard], project, {
      roots: [root],
      scan: fixedScan([rootScan(root, ["/repo/src/a.ts"], 1)]),
    });
    expect(result?.ok).toBe(false);
  });
});

// infra#427/#789: a root whose declared sourceRoots hold no .ts/.tsx at all is a floor violation — the manifest promises source, the checkout has none.
describe("runGuards — per-root floor (D4)", () => {
  test("a root with sourceSurface 0 fails the guard and is named in violatingRoots", () => {
    const dark = repoRoot("fake-root", "/repo/dark");
    const lit = repoRoot("other", "/repo/lit");
    const project = emptyProject();
    project.createSourceFile("/repo/lit/src/a.ts", "export const a = 1;");
    const [result] = runGuards([okGuard], project, {
      roots: [dark, lit],
      scan: fixedScan([rootScan(dark, [], 0), rootScan(lit, ["/repo/lit/src/a.ts"], 1)]),
    });
    expect(result?.violatingRoots).toEqual(["fake-root"]);
    expect(result?.ok).toBe(false);
  });

  test("the same root passes once it has real source surface", () => {
    const root = repoRoot("fake-root", "/repo/dark");
    const project = emptyProject();
    project.createSourceFile("/repo/dark/src/present.ts", "export const x = 1;");
    const [result] = runGuards([okGuard], project, {
      roots: [root],
      scan: fixedScan([rootScan(root, ["/repo/dark/src/present.ts"], 1)]),
    });
    expect(result?.violatingRoots).toBeUndefined();
    expect(result?.ok).toBe(true);
  });

  test("a 'tests' scope guard has no comparable floor — sourceSurface 0 does not fail it", () => {
    const root = repoRoot("fake-root", "/repo/dark");
    const testsGuard: AstGuard = {
      name: "tests-guard",
      scan: { scope: "tests", extensions: ["ts"] },
      run: () => ({ violations: [] }),
    };
    const [result] = runGuards([testsGuard], emptyProject(), {
      roots: [root],
      scan: fixedScan([rootScan(root, [], 0)]),
    });
    expect(checkRootFloor(testsGuard, [rootScan(root, [], 0)]).violatingRoots).toEqual([]);
    expect(result?.violatingRoots).toBeUndefined();
    expect(result?.ok).toBe(true);
  });
});

describe("reportResults — exit-code is the count of failed guards", () => {
  test("counts thrown and violating guards, ignores passing ones", () => {
    let failed = 0;
    captureConsole(() => {
      failed = reportResults([
        { name: "pass", ok: true, ms: 1 },
        { name: "threw", ok: false, ms: 1, error: "stack" },
        {
          name: "violated",
          ok: false,
          ms: 1,
          outcome: {
            violations: [{ file: "f.ts", line: 1, message: "m" }],
          },
        },
      ]);
    });
    expect(failed).toBe(2);
  });

  test("zero failures → exit 0", () => {
    captureConsole(() => {
      expect(reportResults([{ name: "pass", ok: true, ms: 1 }])).toBe(0);
    });
  });

  test("a dark root is named in the output, not just counted", () => {
    const output = captureConsole(() => {
      reportResults([{ name: "g", ok: false, ms: 1, violatingRoots: ["kumiko-studio"] }]);
    });
    expect(output).toContain("kumiko-studio");
    expect(output).toContain("kumiko.json deklariert sourceRoots");
  });
});

// infra#787: a `security: true` guard's own outcome is never the final
// verdict — every finding must clear the injected per-repo baseline first.
describe("runGuards — security guards apply the baseline (infra#787)", () => {
  function securityGuard(violationFile: string): AstGuard {
    return {
      name: "sec-guard",
      scan: SOURCE_SPEC,
      security: true,
      run: () => ({ violations: [{ file: violationFile, line: 1, message: "hit" }] }),
    };
  }

  function projectWith(file: string): Project {
    const project = emptyProject();
    project.createSourceFile(file, "export const x = 1;\n");
    return project;
  }

  test("a finding under a real root fails even with a frozen baseline for a different file", () => {
    const root = rootWithSourceFile("solon");
    const file = join(root.absPath, "src/present.ts");
    const [result] = runGuards([securityGuard(file)], projectWith(file), {
      roots: [root],
      scan: fixedScan([rootScan(root, [file], 1)]),
      securityBaseline: (): SecurityBaselineLoad => ({
        kind: "ok",
        findings: { "sec-guard": { "src/other.ts": 1 } },
        hardFail: [],
      }),
    });
    expect(result?.ok).toBe(false);
    expect(result?.frozenFindings).toBe(0);
  });

  test("a baseline covering the finding passes and reports frozenFindings", () => {
    const root = rootWithSourceFile("solon");
    const file = join(root.absPath, "src/present.ts");
    const [result] = runGuards([securityGuard(file)], projectWith(file), {
      roots: [root],
      scan: fixedScan([rootScan(root, [file], 1)]),
      securityBaseline: (): SecurityBaselineLoad => ({
        kind: "ok",
        findings: { "sec-guard": { "src/present.ts": 1 } },
        hardFail: [],
      }),
    });
    expect(result?.ok).toBe(true);
    expect(result?.frozenFindings).toBe(1);
  });

  test("growth beyond the baseline fails", () => {
    const root = rootWithSourceFile("solon");
    const file = join(root.absPath, "src/present.ts");
    const [result] = runGuards([securityGuard(file)], projectWith(file), {
      roots: [root],
      scan: fixedScan([rootScan(root, [file], 1)]),
      securityBaseline: (): SecurityBaselineLoad => ({ kind: "ok", findings: {}, hardFail: [] }),
    });
    expect(result?.ok).toBe(false);
  });

  test("baseline headroom with no current violations only fails with strictSecurityBaseline (infra#790)", () => {
    const root = rootWithSourceFile("solon");
    const file = `${root.absPath}/src/present.ts`;
    const headroomGuard: AstGuard = {
      name: "sec-guard-headroom",
      scan: SOURCE_SPEC,
      security: true,
      run: () => ({ violations: [] }),
    };
    const securityBaseline = (): SecurityBaselineLoad => ({
      kind: "ok",
      findings: { "sec-guard-headroom": { "src/other.ts": 2 } },
      hardFail: [],
    });
    const [strictResult] = runGuards([headroomGuard], projectWith(file), {
      scan: fixedScan([rootScan(root, [file], 1)]),
      roots: [root],
      securityBaseline,
      strictSecurityBaseline: true,
    });
    expect(strictResult?.ok).toBe(false);

    const [laxResult] = runGuards([headroomGuard], projectWith(file), {
      scan: fixedScan([rootScan(root, [file], 1)]),
      roots: [root],
      securityBaseline,
    });
    expect(laxResult?.ok).toBe(true);
  });

  test("a non-security guard is unaffected by securityBaseline — its violation stays blocking, no frozenFindings", () => {
    const project = emptyProject();
    project.createSourceFile("/repo/src/a.ts", "export const a = 1;");
    const violating: AstGuard = {
      name: "plain-guard",
      scan: SOURCE_SPEC,
      run: () => ({ violations: [{ file: "/repo/src/a.ts", line: 1, message: "nope" }] }),
    };
    const [result] = runGuards([violating], project, {
      roots: [],
      scan: fixedScan([]),
      securityBaseline: (): never => {
        throw new Error("must not be called for a non-security guard");
      },
    });
    expect(result?.ok).toBe(false);
    expect(result?.frozenFindings).toBeUndefined();
  });
});

describe("explainGuards — per guard and root: source, files, source surface", () => {
  test("lists the resolved repo and per guard the resolved files", () => {
    const local = repoRoot("money-horse", "/ws/money-horse");
    const project = emptyProject();
    project.createSourceFile("/ws/money-horse/src/a.ts", "export const a = 1;");
    project.createSourceFile("/ws/money-horse/src/b.ts", "export const b = 1;");

    const lines = explainGuards([okGuard], project, {
      scan: fixedScan([
        rootScan(local, ["/ws/money-horse/src/a.ts", "/ws/money-horse/src/b.ts"], 2),
      ]),
      resolution: {
        roots: [{ root: local, source: "local" }],
      },
    });

    expect(lines).toEqual([
      "Repo: /ws/money-horse",
      "",
      "ok-guard — scope=source ext=ts",
      "  money-horse [local] 2 Dateien (Source-Surface 2)",
    ]);
  });

  test("a guard whose kinds filter excludes the local root says so", () => {
    const local = repoRoot("solon", "/ws/solon", "library");
    const lines = explainGuards([okGuard], emptyProject(), {
      scan: fixedScan([]),
      resolution: { roots: [{ root: local, source: "local" }] },
    });
    expect(lines).toContain("  solon [local] — außerhalb kinds");
  });

  test("no repo found says so instead of printing an empty path", () => {
    const lines = explainGuards([], emptyProject(), {
      resolution: { roots: [] },
    });
    expect(lines[0]).toContain("none found");
  });
});
