import { describe, expect, test } from "bun:test";
import {
  findOutputDiagnostics,
  formatBunTestSummary,
  formatCompactFailure,
  formatCompactSuccess,
} from "../ci-output";

const GITHUB_ACTIONS_ENV = { GITHUB_ACTIONS: "true" };

describe("CI output formatting", () => {
  test("summarizes the trailing Bun test block", () => {
    const output = [
      "8019 pass",
      "4 skip",
      "7 fail",
      "Ran 8030 tests across 737 files. [45.20s]",
    ].join("\n");

    expect(formatBunTestSummary(output)).toBe(
      "8019 pass, 7 fail, 4 skip (8030 tests across 737 files, 45.20s)",
    );
  });

  test("deduplicates diagnostic lines while retaining their count", () => {
    const diagnostics = findOutputDiagnostics(
      "::warning::first\nWARN repeated\nWARN repeated\nERROR second",
    );

    expect(diagnostics).toEqual({
      lines: ["::warning::first", "WARN repeated", "ERROR second"],
      total: 3,
    });
  });

  test("does not classify passing test names as diagnostics", () => {
    const diagnostics = findOutputDiagnostics(
      "(pass) describeUnparseableTscFailure > reports a failed command\n2 pass\nRan 2 tests across 1 file. [10ms]",
    );

    expect(diagnostics).toEqual({ lines: [], total: 0 });
  });

  test("keeps a passing test run to one summary plus diagnostics", () => {
    const output = "dots and setup noise\n2 pass\nRan 2 tests across 1 file. [10ms]\nWARN setup";

    expect(formatCompactSuccess("Unit tests", output)).toBe(
      "  ✓ Unit tests — 2 pass, 0 fail (2 tests across 1 files, 10ms)\n" +
        "    diagnostics: 1 unique warning/error line(s) emitted (non-gating)\n" +
        "      WARN setup\n",
    );
  });
  test("summarizes the aggregate integration report", () => {
    const output = [
      "=== Integration summary ===",
      "  Files: 460/460 executed",
      "  Tests: 3785 pass, 0 fail (3785 total)",
    ].join("\n");

    expect(formatCompactSuccess("Integration tests", output)).toBe(
      "  ✓ Integration tests — 3785 pass, 0 fail (3785 tests across 460/460 files)\n",
    );
  });

  test("prefers the aggregate integration summary over a directory summary", () => {
    const output = [
      "Ran 9 tests across 1 file. [10ms]",
      "=== Integration summary ===",
      "  Files: 460/460 executed",
      "  Tests: 3785 pass, 0 fail (3785 total)",
    ].join("\n");

    expect(formatCompactSuccess("Integration tests", output)).toContain("3785 pass");
  });

  test("never drops repeated lines from failure output, even identical ones", () => {
    const output = "error: same\nerror: same\nsource.ts:1\nsource.ts:2\n";

    expect(formatCompactFailure("TypeScript", 2, output)).toBe(
      "  ✗ TypeScript (exit 2; 4 line(s))\n" +
        "    error: same\n" +
        "    error: same\n" +
        "    source.ts:1\n" +
        "    source.ts:2\n",
    );
  });

  test("caps a runaway failure to head+tail instead of printing everything", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const result = formatCompactFailure("Huge failure", 1, lines.join("\n"), { env: {} });

    expect(result).toContain("500 line(s)");
    expect(result).toContain("line 0");
    expect(result).toContain("line 99");
    expect(result).not.toContain("line 100\n");
    expect(result).toContain("300 line(s) omitted");
    expect(result).toContain("line 400");
    expect(result).toContain("line 499");
  });

  test("keeps a buried bun test failure visible despite heavy React act() noise", () => {
    const noiseLine = "Warning: An update to Component inside a test was not wrapped in act(...).";
    const before = Array.from({ length: 300 }, () => noiseLine);
    const failureBlock = [
      "packages/renderer-web/src/__tests__/zz-probe.test.tsx:",
      '1 | import { expect, test } from "bun:test";',
      '2 | test("zz probe fails", () => {',
      "3 |   expect({ a: 1 }).toEqual({ a: 2 });",
      "                       ^",
      "error: expect(received).toEqual(expected)",
      "  {",
      '-   "a": 2,',
      '+   "a": 1,',
      "  }",
      "- Expected  - 1",
      "+ Received  + 1",
      "      at <anonymous> (/abs/path/zz-probe.test.tsx:3:20)",
      "(fail) zz probe fails [1.56ms]",
    ];
    const after = Array.from({ length: 300 }, () => noiseLine);
    const output = [...before, ...failureBlock, ...after].join("\n");

    const result = formatCompactFailure("DOM Tests (framework)", 1, output, { env: {} });

    expect(result).toContain("(fail) zz probe fails");
    expect(result).toContain("error: expect(received).toEqual(expected)");
    expect(result).toContain("at <anonymous> (/abs/path/zz-probe.test.tsx:3:20)");
  });

  test("caps buried failures to the first 5 windows once more than 5 tests fail", () => {
    const noiseLine = "Warning: act() noise";
    const failLine = (n: number) => `(fail) probe ${n} fails [1ms]`;
    const segments: string[] = [];
    for (let i = 0; i < 6; i++) {
      segments.push(...Array.from({ length: 150 }, () => noiseLine));
      segments.push(failLine(i));
    }
    segments.push(...Array.from({ length: 150 }, () => noiseLine));
    const output = segments.join("\n");

    const result = formatCompactFailure("Huge failure", 1, output, { env: {} });

    for (let i = 0; i < 5; i++) expect(result).toContain(failLine(i));
    expect(result).not.toContain(failLine(5));
    // MAX_FAILURE_LINES (200) + 5 windows * 43 lines = 415 content lines, plus
    // header, indentation and a handful of omission markers.
    expect(result.split("\n").length).toBeLessThanOrEqual(430);
  });

  test("leaves a short failure output unmodified with no omission marker", () => {
    const output = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");

    const result = formatCompactFailure("Small failure", 1, output, { env: {} });

    expect(result).not.toContain("omitted");
    expect(result).toContain("line 0");
    expect(result).toContain("line 49");
  });

  test("keeps repeated identical lines inside a failure window without deduping", () => {
    const noiseLine = "Warning: act() noise";
    const before = Array.from({ length: 300 }, () => noiseLine);
    const failureBlock = ["error: same", "error: same", "(fail) probe fails [1ms]"];
    const after = Array.from({ length: 300 }, () => noiseLine);
    const output = [...before, ...failureBlock, ...after].join("\n");

    const result = formatCompactFailure("Dup lines", 1, output, { env: {} });
    const occurrences = result.split("error: same").length - 1;

    expect(occurrences).toBe(2);
  });

  test("does not classify an @cosmicdrift package line as a diagnostic", () => {
    const diagnostics = findOutputDiagnostics("+ @cosmicdrift/kumiko-framework@0.284.0\nSaved lockfile");

    expect(diagnostics).toEqual({ lines: [], total: 0 });
  });

  test("picks the pass/fail/skip counts belonging to the last test block, not an earlier one", () => {
    const output = [
      "1 pass",
      "0 fail",
      "Ran 1 tests across 1 file. [1ms]",
      "9 pass",
      "2 fail",
      "Ran 11 tests across 3 files. [5ms]",
    ].join("\n");

    expect(formatBunTestSummary(output)).toBe("9 pass, 2 fail (11 tests across 3 files, 5ms)");
  });

  test("does not classify a routine [runProdApp] boot log as a diagnostic", () => {
    const diagnostics = findOutputDiagnostics("[runProdApp] booting Kumiko stack on port 3000…");

    expect(diagnostics).toEqual({ lines: [], total: 0 });
  });

  test("still classifies a real [runProdApp] boot abort as a diagnostic", () => {
    const diagnostics = findOutputDiagnostics(
      "\n[runProdApp] BOOT ABORTED — KMS health check failed (latency 42ms)",
    );

    expect(diagnostics.lines).toEqual(["[runProdApp] BOOT ABORTED — KMS health check failed (latency 42ms)"]);
  });

  test("does not classify a routine [runProdApp] shutdown log as a diagnostic", () => {
    const diagnostics = findOutputDiagnostics("[runProdApp] SIGTERM received — draining…");

    expect(diagnostics).toEqual({ lines: [], total: 0 });
  });

  test("does not classify a benign schema-check success line as a diagnostic", () => {
    const diagnostics = findOutputDiagnostics("✓ schema check: 3 mounted ↔ 3 registry entries, no drift");

    expect(diagnostics).toEqual({ lines: [], total: 0 });
  });

  test("wraps a capped failure in a GitHub Actions log group with the full output", () => {
    const noiseLine = (i: number) => `noise line ${i}`;
    const before = Array.from({ length: 350 }, (_, i) => noiseLine(i));
    const failureBlock = [
      "error: expect(received).toEqual(expected)",
      "  at <anonymous> (/abs/path/zz-probe.test.tsx:3:20)",
      "(fail) zz probe fails [1.56ms]",
    ];
    const after = Array.from({ length: 357 }, (_, i) => noiseLine(650 + i));
    const output = [...before, ...failureBlock, ...after].join("\n");

    const result = formatCompactFailure("Huge failure", 1, output, {
      env: GITHUB_ACTIONS_ENV,
      stopCommandsToken: "TOKEN",
    });

    const groupIndex = result.indexOf("::group::Full output: Huge failure (710 lines)");
    const stopIndex = result.indexOf("::stop-commands::TOKEN");
    const resumeIndex = result.indexOf("::TOKEN::", stopIndex + 1);
    const endgroupIndex = result.indexOf("::endgroup::");

    expect(groupIndex).toBeGreaterThan(-1);
    expect(stopIndex).toBeGreaterThan(groupIndex);
    expect(resumeIndex).toBeGreaterThan(stopIndex);
    expect(endgroupIndex).toBeGreaterThan(resumeIndex);

    const compactPart = result.slice(0, groupIndex);
    expect(compactPart).toContain("line(s) omitted (see the 'Full output: Huge failure' group below)");
    expect(compactPart).not.toContain(`\n    ${noiseLine(200)}\n`);

    const fullPart = result.slice(groupIndex);
    for (let i = 0; i < 350; i++) expect(fullPart).toContain(`\n    ${noiseLine(i)}\n`);
    for (let i = 0; i < 357; i++) expect(fullPart).toContain(`\n    ${noiseLine(650 + i)}\n`);
    expect(fullPart).toContain("(fail) zz probe fails");
    expect(result.endsWith("::endgroup::\n")).toBe(true);
  });

  test("caps the full-output group itself past the 20000-line ceiling", () => {
    const lines = Array.from({ length: 25_000 }, (_, i) =>
      i === 12_000 ? "(fail) buried probe fails [1ms]" : `line ${i}`,
    );
    const output = lines.join("\n");

    const result = formatCompactFailure("Massive failure", 1, output, {
      env: GITHUB_ACTIONS_ENV,
      stopCommandsToken: "TOKEN",
    });

    const groupPart = result.slice(result.indexOf("::group::"));
    expect(groupPart).toContain("full output exceeds the 20000-line cap");
    expect(groupPart).toContain("(fail) buried probe fails");
  });

  test("does not group a failure that fits within the compact cap even on GitHub Actions", () => {
    const output = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");

    const result = formatCompactFailure("Small failure", 1, output, { env: GITHUB_ACTIONS_ENV });

    expect(result).not.toContain("::group::");
    expect(result).not.toContain("omitted");
  });

  test("omits without a misleading rerun hint outside GitHub Actions", () => {
    const output = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");

    const result = formatCompactFailure("Huge failure", 1, output, { env: {} });

    expect(result).not.toContain("::group::");
    expect(result).not.toContain("Full output");
    expect(result).not.toContain("rerun");
    expect(result).toMatch(/line\(s\) omitted …/);
  });

  test("keeps workflow-command-looking test output inside the stop-commands pair", () => {
    const before = Array.from({ length: 300 }, (_, i) => `noise ${i}`);
    const failureBlock = ["::add-mask::x", "::error::boom", "(fail) probe fails [1ms]"];
    const after = Array.from({ length: 300 }, (_, i) => `noise ${300 + i}`);
    const output = [...before, ...failureBlock, ...after].join("\n");

    const result = formatCompactFailure("Dangerous output", 1, output, {
      env: GITHUB_ACTIONS_ENV,
      stopCommandsToken: "TOKEN",
    });

    const stopIndex = result.indexOf("::stop-commands::TOKEN");
    const resumeIndex = result.indexOf("::TOKEN::", stopIndex + 1);
    const maskIndex = result.indexOf("::add-mask::x", stopIndex + 1);
    const errorIndex = result.indexOf("::error::boom", stopIndex + 1);

    expect(stopIndex).toBeGreaterThan(-1);
    expect(maskIndex).toBeGreaterThan(stopIndex);
    expect(errorIndex).toBeGreaterThan(stopIndex);
    expect(maskIndex).toBeLessThan(resumeIndex);
    expect(errorIndex).toBeLessThan(resumeIndex);
  });
});
