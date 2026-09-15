import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineRatchet, compareToBaseline } from "../_lib/guard-kit";

describe("compareToBaseline", () => {
  test("passes when every file stays at its baseline", () => {
    const result = compareToBaseline({ "a.ts": 2 }, { "a.ts": 2 });
    expect(result.regressions).toEqual([]);
    expect(result.reduced).toBe(0);
  });

  test("flags a file that gained a hotspot", () => {
    const result = compareToBaseline({ "a.ts": 3 }, { "a.ts": 2 });
    expect(result.regressions).toEqual([{ file: "a.ts", baseline: 2, current: 3 }]);
  });

  test("flags a file missing from the baseline", () => {
    const result = compareToBaseline({ "new.ts": 1 }, {});
    expect(result.regressions).toEqual([{ file: "new.ts", baseline: 0, current: 1 }]);
  });

  test("counts reductions instead of failing on them", () => {
    const result = compareToBaseline({ "a.ts": 1 }, { "a.ts": 4 });
    expect(result.regressions).toEqual([]);
    expect(result.reduced).toBe(3);
  });

  test("a file dropped from the scan counts as fully reduced", () => {
    const result = compareToBaseline({}, { "gone.ts": 2 });
    expect(result.regressions).toEqual([]);
    expect(result.reduced).toBe(2);
  });

  test("does not let a reduction elsewhere mask a regression", () => {
    const result = compareToBaseline({ "a.ts": 5, "b.ts": 0 }, { "a.ts": 3, "b.ts": 2 });
    expect(result.regressions).toEqual([{ file: "a.ts", baseline: 3, current: 5 }]);
    expect(result.reduced).toBe(2);
  });
});

describe("baselineRatchet", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guard-kit-baseline-"));
    file = join(dir, "baseline.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("check() passes without failing when no baseline file exists yet", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    expect(ratchet.check({ "a.ts": 5 }, "fix it")).toEqual([]);
  });

  test("write() then check() with the same counts passes", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    ratchet.write({ "a.ts": 2 });
    expect(ratchet.check({ "a.ts": 2 }, "fix it")).toEqual([]);
  });

  test("check() flags a regression and resolves its line via resolveLine", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    ratchet.write({ "a.ts": 1 });
    const violations = ratchet.check({ "a.ts": 3 }, "fix it", {
      resolveLine: (f) => (f === "a.ts" ? 42 : 1),
    });
    expect(violations).toEqual([
      {
        file: "a.ts",
        line: 42,
        message: "hit(s) über Baseline: baseline=1 current=3 (+2). fix it",
      },
    ]);
  });

  test("check() defaults regression line to 1 without a resolveLine callback", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    ratchet.write({ "a.ts": 1 });
    const violations = ratchet.check({ "a.ts": 3 }, "fix it");
    expect(violations[0]?.line).toBe(1);
  });

  test("check() reports format drift using formatDriftRemediation, not the regression remediation", () => {
    writeFileSync(
      file,
      JSON.stringify({
        format: 0,
        generated: "2020-01-01",
        total: 0,
        perFile: {},
      }),
    );
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    const violations = ratchet.check({ "a.ts": 1 }, "split the function", {
      formatDriftRemediation: "regenerate the baseline",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("regenerate the baseline");
    expect(violations[0]?.message).not.toContain("split the function");
  });

  test("check() falls back to the regression remediation when formatDriftRemediation is omitted", () => {
    writeFileSync(
      file,
      JSON.stringify({
        format: 0,
        generated: "2020-01-01",
        total: 0,
        perFile: {},
      }),
    );
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    const violations = ratchet.check({ "a.ts": 1 }, "split the function");
    expect(violations[0]?.message).toContain("split the function");
  });

  test("handleCli() writes the baseline on --write-baseline", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    const originalArgv = process.argv;
    process.argv = [...originalArgv.slice(0, 2), "--write-baseline"];
    try {
      expect(ratchet.handleCli({ "a.ts": 2 })).toBe(true);
      expect(ratchet.check({ "a.ts": 2 }, "fix it")).toEqual([]);
    } finally {
      process.argv = originalArgv;
    }
  });

  test("handleCli() returns false without --write-baseline or --no-baseline", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    const originalArgv = process.argv;
    process.argv = originalArgv.slice(0, 2);
    try {
      expect(ratchet.handleCli({ "a.ts": 2 })).toBe(false);
    } finally {
      process.argv = originalArgv;
    }
  });
});

// infra#445/#419-1 coverage (checkRootFloor brace-extensions, reportResults' vacuous case) tested mechanics infra#789 removed outright; see "per-root floor (D4)" and "exit-code is the count of failed guards" in ./_lib/guard-kit.test.ts instead.
