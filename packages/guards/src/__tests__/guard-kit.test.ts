import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  test("check() without a baseline file fails every unfrozen entry", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    const violations = ratchet.check({ "a.ts": 5, "b.ts": 0 }, "fix it");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("a.ts");
    expect(violations[0]?.message).toContain("without a baseline file");
    expect(violations[0]?.message).toContain("--write-baseline");
  });

  test("check() with no baseline file and no findings passes silently", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
      expect(ratchet.check({}, "fix it")).toEqual([]);
      expect(ratchet.check({ "a.ts": 0 }, "fix it")).toEqual([]);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("no baseline file: passes without findings, fails with findings and resolves the line", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    expect(ratchet.check({}, "fix it")).toEqual([]);
    const violations = ratchet.check({ "a.ts": 2 }, "fix it", { resolveLine: () => 7 });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(7);
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
        message: "hit(s) over baseline: baseline=1 current=3 (+2). fix it",
      },
    ]);
  });

  test("check() reports a smaller count as a stale baseline", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    ratchet.write({ "a.ts": 3 });
    const violations = ratchet.check({ "a.ts": 1 }, "fix it", { resolveLine: () => 8 });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("a.ts");
    expect(violations[0]?.line).toBe(8);
    expect(violations[0]?.message).toContain("under baseline: baseline=3 current=1");
    expect(violations[0]?.message).toContain("--write-baseline");
  });

  test("check() reports a regression and a stale entry in the same run", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    ratchet.write({ "a.ts": 1, "b.ts": 3 });
    const violations = ratchet.check({ "a.ts": 2, "b.ts": 1 }, "fix it");
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.file).sort()).toEqual(["a.ts", "b.ts"]);
    expect(violations.some((v) => v.message.includes("over baseline"))).toBe(true);
    expect(violations.some((v) => v.message.includes("under baseline"))).toBe(true);
  });

  test("write() stores only format and perFile", () => {
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    ratchet.write({ "a.ts": 2 });
    const written: unknown = JSON.parse(readFileSync(file, "utf-8"));
    expect(written).toEqual({ format: 1, perFile: { "a.ts": 2 } });
  });

  test("check() still reads an old baseline carrying generated and total", () => {
    writeFileSync(
      file,
      JSON.stringify({ format: 1, generated: "2020-01-01", total: 2, perFile: { "a.ts": 2 } }),
    );
    const ratchet = baselineRatchet({ file, formatVersion: 1, unit: "hit(s)" });
    expect(ratchet.check({ "a.ts": 2 }, "fix it")).toEqual([]);
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

// coverage (checkRootFloor brace-extensions, reportResults' vacuous case) tested mechanics removed outright; see "per-root floor (D4)" and "exit-code is the count of failed guards" in ./_lib/guard-kit.test.ts instead.
