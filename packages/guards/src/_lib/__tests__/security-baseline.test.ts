import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  applySecurityBaseline,
  buildSecurityBaseline,
  loadSecurityBaseline,
  locateFinding,
  parseSecurityBaseline,
  type SecurityBaselineLoad,
  securityBaselinePath,
} from "../security-baseline";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRoot(name: string): { name: string; absPath: string } {
  const absPath = mkdtempSync(join(tmpdir(), "sec-baseline-root-"));
  tmpDirs.push(absPath);
  return { name, absPath };
}

function writeRealFile(root: string, relPath: string): string {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "export {};\n");
  return abs;
}

function baselineDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sec-baseline-dir-"));
  tmpDirs.push(dir);
  return dir;
}

function writeBaselineFile(dir: string, content: unknown): void {
  writeFileSync(securityBaselinePath(dir), JSON.stringify(content));
}

describe("locateFinding", () => {
  test("a relative path resolves against the given cwd", () => {
    const root = tmpRoot("money-horse");
    writeRealFile(root.absPath, "src/a.ts");
    expect(locateFinding("src/a.ts", [root], root.absPath)).toEqual({
      repo: "money-horse",
      relPath: "src/a.ts",
    });
  });

  test("an absolute path under a root resolves regardless of cwd", () => {
    const root = tmpRoot("solon");
    const abs = writeRealFile(root.absPath, "src/b.ts");
    expect(locateFinding(abs, [root], "/somewhere/else")).toEqual({
      repo: "solon",
      relPath: "src/b.ts",
    });
  });

  test("the <scan> misconfiguration-canary pseudo file is never located", () => {
    const root = tmpRoot("solon");
    expect(locateFinding("<scan>", [root], root.absPath)).toBeUndefined();
  });

  test("a path outside every resolved root is undefined", () => {
    const root = tmpRoot("solon");
    const outside = tmpRoot("elsewhere");
    const abs = writeRealFile(outside.absPath, "src/c.ts");
    expect(locateFinding(abs, [root], "/irrelevant")).toBeUndefined();
  });
});

describe("securityBaselinePath", () => {
  test("resolves to <repoDir>/.kumiko-security-baseline.json", () => {
    expect(securityBaselinePath("/tmp/repo")).toBe("/tmp/repo/.kumiko-security-baseline.json");
  });
});

describe("loadSecurityBaseline", () => {
  test("a missing file is fail-closed zero tolerance, not an error", () => {
    expect(loadSecurityBaseline("money-horse", baselineDir())).toEqual({
      kind: "ok",
      findings: {},
      hardFail: [],
    });
  });

  test("rejects a repo name that isn't a plain or scoped npm package name", () => {
    expect(() => loadSecurityBaseline("../x", baselineDir())).toThrow();
    expect(() => loadSecurityBaseline("a/../../b", baselineDir())).toThrow();
  });

  test("accepts a scoped npm package name", () => {
    expect(loadSecurityBaseline("@cosmicdrift/kumiko-guards", baselineDir())).toEqual({
      kind: "ok",
      findings: {},
      hardFail: [],
    });
  });

  test("broken JSON is invalid", () => {
    const dir = baselineDir();
    writeFileSync(securityBaselinePath(dir), "{ not json");
    expect(loadSecurityBaseline("money-horse", dir).kind).toBe("invalid");
  });

  test("a repo field that does not match the requested repo is invalid", () => {
    const dir = baselineDir();
    writeBaselineFile(dir, {
      format: 1,
      repo: "solon",
      generated: "2026-01-01",
      total: 0,
      findings: {},
    });
    expect(loadSecurityBaseline("money-horse", dir).kind).toBe("invalid");
  });

  test("a negative count is invalid", () => {
    const dir = baselineDir();
    writeBaselineFile(dir, {
      format: 1,
      repo: "money-horse",
      generated: "2026-01-01",
      total: 1,
      findings: { "Direct-Fetch Guard": { "src/a.ts": -1 } },
    });
    expect(loadSecurityBaseline("money-horse", dir).kind).toBe("invalid");
  });

  test("a non-integer count is invalid", () => {
    const dir = baselineDir();
    writeBaselineFile(dir, {
      format: 1,
      repo: "money-horse",
      generated: "2026-01-01",
      total: 1,
      findings: { "Direct-Fetch Guard": { "src/a.ts": 1.5 } },
    });
    expect(loadSecurityBaseline("money-horse", dir).kind).toBe("invalid");
  });

  test("a valid baseline loads its findings", () => {
    const dir = baselineDir();
    const findings = { "Direct-Fetch Guard": { "src/a.ts": 2 } };
    writeBaselineFile(dir, {
      format: 1,
      repo: "money-horse",
      generated: "2026-01-01",
      total: 2,
      findings,
    });
    expect(loadSecurityBaseline("money-horse", dir)).toEqual({
      kind: "ok",
      findings,
      hardFail: [],
    });
  });
});

describe("parseSecurityBaseline hardFail", () => {
  function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      format: 1,
      repo: "money-horse",
      generated: "2026-01-01",
      total: 0,
      findings: {},
      ...overrides,
    };
  }

  test("a valid hardFail array with no findings for those guards parses", () => {
    const parsed = parseSecurityBaseline(base({ hardFail: ["Direct-Fetch Guard"] }));
    expect(parsed?.hardFail).toEqual(["Direct-Fetch Guard"]);
  });

  test("a missing hardFail field parses as undefined", () => {
    expect(parseSecurityBaseline(base())?.hardFail).toBeUndefined();
  });

  test("hardFail that is not an array is invalid", () => {
    expect(parseSecurityBaseline(base({ hardFail: "Direct-Fetch Guard" }))).toBeUndefined();
  });

  test("a duplicate guard name in hardFail is invalid", () => {
    expect(
      parseSecurityBaseline(base({ hardFail: ["Direct-Fetch Guard", "Direct-Fetch Guard"] })),
    ).toBeUndefined();
  });

  test("a hardFail guard with current findings entries is invalid", () => {
    expect(
      parseSecurityBaseline(
        base({
          hardFail: ["Direct-Fetch Guard"],
          findings: { "Direct-Fetch Guard": { "src/a.ts": 1 } },
        }),
      ),
    ).toBeUndefined();
  });

  test("a hardFail guard with an empty {} findings entry is valid", () => {
    const parsed = parseSecurityBaseline(
      base({
        hardFail: ["Direct-Fetch Guard"],
        findings: { "Direct-Fetch Guard": {} },
      }),
    );
    expect(parsed?.hardFail).toEqual(["Direct-Fetch Guard"]);
  });
});

function loadFrom(
  map: Record<string, SecurityBaselineLoad>,
): (repo: string) => SecurityBaselineLoad {
  return (repo) => map[repo] ?? { kind: "ok", findings: {}, hardFail: [] };
}

describe("applySecurityBaseline", () => {
  test("(a) a finding with no baseline coverage is blocking", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({}),
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.frozen).toBe(0);
  });

  test("(b) a count equal to the baseline is frozen, not blocking", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Direct-Fetch Guard": { "src/a.ts": 1 } },
          hardFail: [],
        },
      }),
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.frozen).toBe(1);
  });

  test("(c) a count above the baseline blocks every violation of the group, message suffixed", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [
        { file, line: 1, message: "raw fetch A" },
        { file, line: 2, message: "raw fetch B" },
      ],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Direct-Fetch Guard": { "src/a.ts": 1 } },
          hardFail: [],
        },
      }),
    });
    expect(result.blocking).toHaveLength(2);
    expect(result.blocking[0]?.message).toContain("raw fetch A");
    expect(result.blocking[0]?.message).toContain(
      "security baseline money-horse: allowed=1, current=2",
    );
    expect(result.blocking[1]?.message).toContain("raw fetch B");
  });

  test("(d) a count below the baseline is not blocking and reports the reduction", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Direct-Fetch Guard": { "src/a.ts": 3 } },
          hardFail: [],
        },
      }),
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.frozen).toBe(1);
    expect(result.reduced).toBe(2);
  });

  test("(e) an invalid baseline blocks the whole repo group plus a baseline-file violation", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "invalid",
          file: "/baselines/money-horse.json",
          reason: "kaputt",
        },
      }),
    });
    expect(result.blocking).toHaveLength(2);
    expect(result.blocking[0]?.file).toBe("/baselines/money-horse.json");
    expect(result.blocking[0]?.message).toContain("kaputt");
    expect(result.blocking[1]?.message).toBe("raw fetch");
  });

  test("(f) an unlocatable finding stays blocking", () => {
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file: "<scan>", line: 0, message: "misconfigured" }],
      roots: [],
      cwd: "/irrelevant",
      load: loadFrom({}),
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.message).toBe("misconfigured");
  });

  test("(g) a neverFrozen finding is always blocking, even when the baseline covers it", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "placeholder reason", neverFrozen: true }],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Direct-Fetch Guard": { "src/a.ts": 100 } },
          hardFail: [],
        },
      }),
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.message).toBe("placeholder reason");
    expect(result.frozen).toBe(0);
  });

  test("(h) a neverFrozen finding is not counted toward another finding's per-file baseline", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [
        { file, line: 1, message: "placeholder reason", neverFrozen: true },
        { file, line: 2, message: "raw fetch" },
      ],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Direct-Fetch Guard": { "src/a.ts": 1 } },
          hardFail: [],
        },
      }),
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.message).toBe("placeholder reason");
    expect(result.frozen).toBe(1);
  });

  test("(i) a guard listed in hardFail blocks every finding of that guard, even one a normal baseline would freeze", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const load: (repo: string) => SecurityBaselineLoad = () => ({
      kind: "ok",
      findings: {},
      hardFail: ["Direct-Fetch Guard"],
    });
    const result = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load,
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.message).toBe(
      "raw fetch (security baseline money-horse: Direct-Fetch Guard finished migrating — no baseline tolerance)",
    );
    expect(result.frozen).toBe(0);
  });
});

describe("applySecurityBaseline strict mode", () => {
  test("baseline 3, current 1: strict blocks with the stale-baseline message; non-strict does not", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const load = loadFrom({
      "money-horse": {
        kind: "ok",
        findings: { "Direct-Fetch Guard": { "src/a.ts": 3 } },
        hardFail: [],
      },
    });
    const strict = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load,
      strict: true,
    });
    expect(strict.blocking).toHaveLength(1);
    expect(strict.blocking[0]?.message).toBe(
      "Security baseline stale: money-horse/src/a.ts allows 3, found 1 — run `--write-security-baseline` and commit, otherwise the headroom covers new findings.",
    );

    const lax = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load,
    });
    expect(lax.blocking).toHaveLength(0);
  });

  test("a baseline entry for a file with no current findings, repo entirely without violations: strict reports it stale; non-strict does not", () => {
    const root = tmpRoot("money-horse");
    const load = loadFrom({
      "money-horse": {
        kind: "ok",
        findings: { "Direct-Fetch Guard": { "src/x.ts": 2 } },
        hardFail: [],
      },
    });
    const strict = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [],
      roots: [root],
      cwd: "/irrelevant",
      load,
      strict: true,
    });
    expect(strict.blocking).toHaveLength(1);
    expect(strict.blocking[0]?.message).toContain("allows 2, found 0");

    const lax = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [],
      roots: [root],
      cwd: "/irrelevant",
      load,
    });
    expect(lax.blocking).toHaveLength(0);
  });

  test("current equals baseline: strict blocking stays empty, frozen unaffected", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const strict = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Direct-Fetch Guard": { "src/a.ts": 1 } },
          hardFail: [],
        },
      }),
      strict: true,
    });
    expect(strict.blocking).toHaveLength(0);
    expect(strict.frozen).toBe(1);
  });

  test("growth beyond the baseline: strict blocks the original violations, no extra stale finding", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const strict = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [
        { file, line: 1, message: "raw fetch A" },
        { file, line: 2, message: "raw fetch B" },
      ],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Direct-Fetch Guard": { "src/a.ts": 1 } },
          hardFail: [],
        },
      }),
      strict: true,
    });
    expect(strict.blocking).toHaveLength(2);
    expect(strict.blocking.every((v) => !v.message.includes("Security baseline stale"))).toBe(
      true,
    );
  });

  test("invalid baseline, repo without violations: strict reports one baseline-file finding; non-strict none", () => {
    const root = tmpRoot("money-horse");
    const load = loadFrom({
      "money-horse": { kind: "invalid", file: "/baselines/money-horse.json", reason: "kaputt" },
    });
    const strict = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [],
      roots: [root],
      cwd: "/irrelevant",
      load,
      strict: true,
    });
    expect(strict.blocking).toHaveLength(1);
    expect(strict.blocking[0]?.file).toBe("/baselines/money-horse.json");

    const lax = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [],
      roots: [root],
      cwd: "/irrelevant",
      load,
    });
    expect(lax.blocking).toHaveLength(0);
  });

  test("invalid baseline, repo with violations: strict does not report the baseline-file finding twice", () => {
    const root = tmpRoot("money-horse");
    const file = writeRealFile(root.absPath, "src/a.ts");
    const strict = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [{ file, line: 1, message: "raw fetch" }],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "invalid",
          file: "/baselines/money-horse.json",
          reason: "kaputt",
        },
      }),
      strict: true,
    });
    expect(strict.blocking).toHaveLength(2);
  });

  test("a baseline entry under a different guard's name is irrelevant, even with a higher count", () => {
    const root = tmpRoot("money-horse");
    const strict = applySecurityBaseline({
      guardName: "Direct-Fetch Guard",
      violations: [],
      roots: [root],
      cwd: "/irrelevant",
      load: loadFrom({
        "money-horse": {
          kind: "ok",
          findings: { "Other Guard": { "src/a.ts": 5 } },
          hardFail: [],
        },
      }),
      strict: true,
    });
    expect(strict.blocking).toHaveLength(0);
  });
});

describe("buildSecurityBaseline", () => {
  test("counts only the given repo's violations, sorted per file, with a total", () => {
    const money = tmpRoot("money-horse");
    const solon = tmpRoot("solon");
    const fileB = writeRealFile(money.absPath, "src/b.ts");
    const fileA = writeRealFile(money.absPath, "src/a.ts");
    const fileOther = writeRealFile(solon.absPath, "src/x.ts");
    const baseline = buildSecurityBaseline(
      "money-horse",
      [
        {
          guardName: "Direct-Fetch Guard",
          violations: [
            { file: fileB, line: 1, message: "m" },
            { file: fileB, line: 2, message: "m" },
            { file: fileA, line: 1, message: "m" },
            { file: fileOther, line: 1, message: "m" },
          ],
        },
      ],
      [money, solon],
      "/irrelevant",
    );
    expect(baseline.repo).toBe("money-horse");
    expect(baseline.total).toBe(3);
    expect(baseline.findings).toEqual({
      "Direct-Fetch Guard": { "src/a.ts": 1, "src/b.ts": 2 },
    });
    expect(Object.keys(baseline.findings["Direct-Fetch Guard"] ?? {})).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("skips neverFrozen violations", () => {
    const money = tmpRoot("money-horse");
    const fileA = writeRealFile(money.absPath, "src/a.ts");
    const baseline = buildSecurityBaseline(
      "money-horse",
      [
        {
          guardName: "Escape-Hatch-Declared Guard",
          violations: [
            { file: fileA, line: 1, message: "concrete finding" },
            { file: fileA, line: 2, message: "placeholder reason", neverFrozen: true },
          ],
        },
      ],
      [money],
      "/irrelevant",
    );
    expect(baseline.total).toBe(1);
    expect(baseline.findings).toEqual({
      "Escape-Hatch-Declared Guard": { "src/a.ts": 1 },
    });
  });

  test("hardFail guards' findings are not frozen into the baseline, and the field is carried over sorted", () => {
    const money = tmpRoot("money-horse");
    const fileA = writeRealFile(money.absPath, "src/a.ts");
    const baseline = buildSecurityBaseline(
      "money-horse",
      [
        {
          guardName: "Direct-Fetch Guard",
          violations: [{ file: fileA, line: 1, message: "m" }],
        },
        {
          guardName: "Other Guard",
          violations: [{ file: fileA, line: 1, message: "m" }],
        },
      ],
      [money],
      "/irrelevant",
      ["Other Guard", "Direct-Fetch Guard"],
    );
    expect(baseline.total).toBe(0);
    expect(baseline.findings).toEqual({});
    expect(baseline.hardFail).toEqual(["Direct-Fetch Guard", "Other Guard"]);
  });

  test("a non-hardFail guard's findings still freeze even when the repo has other hardFail guards", () => {
    const money = tmpRoot("money-horse");
    const fileA = writeRealFile(money.absPath, "src/a.ts");
    const baseline = buildSecurityBaseline(
      "money-horse",
      [
        {
          guardName: "Direct-Fetch Guard",
          violations: [{ file: fileA, line: 1, message: "m" }],
        },
        {
          guardName: "Other Guard",
          violations: [{ file: fileA, line: 1, message: "m" }],
        },
      ],
      [money],
      "/irrelevant",
      ["Direct-Fetch Guard"],
    );
    expect(baseline.total).toBe(1);
    expect(baseline.findings).toEqual({ "Other Guard": { "src/a.ts": 1 } });
    expect(baseline.hardFail).toEqual(["Direct-Fetch Guard"]);
  });
});
