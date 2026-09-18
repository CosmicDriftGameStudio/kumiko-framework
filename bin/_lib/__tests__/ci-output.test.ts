import { describe, expect, test } from "bun:test";
import {
  findOutputDiagnostics,
  formatBunTestSummary,
  formatCompactFailure,
  formatCompactSuccess,
} from "../ci-output";

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
    const result = formatCompactFailure("Huge failure", 1, lines.join("\n"));

    expect(result).toContain("500 line(s)");
    expect(result).toContain("line 0");
    expect(result).toContain("line 99");
    expect(result).not.toContain("line 100\n");
    expect(result).toContain("300 line(s) omitted");
    expect(result).toContain("line 400");
    expect(result).toContain("line 499");
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
});
