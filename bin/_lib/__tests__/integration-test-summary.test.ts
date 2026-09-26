import { describe, expect, test } from "bun:test";
import { parseBunTestRunOutput, isIntegrationPerfFile, integrationRunModeFromArgv } from "../integration-test";
import { printIntegrationSummary } from "../../../scripts/run-integration-tests";

describe("parseBunTestRunOutput", () => {
  test("parses pass/fail/tests/files from bun footer", () => {
    const output = [
      "(pass) foo [1ms]",
      "",
      " 20 pass",
      " 5 fail",
      "Ran 25 tests across 2 files. [804.00ms]",
    ].join("\n");

    expect(parseBunTestRunOutput(output)).toEqual({
      pass: 20,
      fail: 5,
      tests: 25,
      files: 2,
    });
  });

  test("uses the last Ran line when output contains noise", () => {
    const output = [
      "Ran 1 tests across 99 files.",
      "(pass) ok",
      " 3 pass",
      " 0 fail",
      "Ran 3 tests across 1 files. [10ms]",
    ].join("\n");

    expect(parseBunTestRunOutput(output)).toEqual({
      pass: 3,
      fail: 0,
      tests: 3,
      files: 1,
    });
  });

  test("returns null when bun summary is missing", () => {
    expect(parseBunTestRunOutput("no tests here")).toBeNull();
  });
});

describe("isIntegrationPerfFile", () => {
  test("matches perf gate filenames", () => {
    expect(isIntegrationPerfFile("packages/framework/src/pipeline/__tests__/perf-rebuild.integration.test.ts")).toBe(
      true,
    );
    expect(
      isIntegrationPerfFile("packages/framework/src/event-store/__tests__/get-stream-version-perf.integration.test.ts"),
    ).toBe(true);
    expect(isIntegrationPerfFile("packages/framework/src/event-store/__tests__/snapshot.integration.test.ts")).toBe(
      false,
    );
  });
});

describe("integrationRunModeFromArgv", () => {
  test("defaults to bulk", () => {
    expect(integrationRunModeFromArgv([])).toBe("bulk");
  });

  test("selects perf from --perf flag", () => {
    expect(integrationRunModeFromArgv(["--perf"])).toBe("perf");
  });
});

describe("printIntegrationSummary", () => {
  test("flags a file-count mismatch against the single combined run", () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    try {
      const { exitCode } = printIntegrationSummary(
        {
          includedFiles: [
            "packages/a/__tests__/one.integration.test.ts",
            "packages/b/__tests__/two.integration.test.ts",
          ],
        },
        {
          totals: { pass: 1, fail: 2, tests: 3, files: 1 },
          exitCode: 1,
          noMatchingFiles: false,
        },
        "bulk",
      );

      expect(exitCode).toBe(1);
      expect(logs.some((line) => line.includes("Files: 1/2 executed"))).toBe(true);
      expect(logs.some((line) => line.includes("MISMATCH"))).toBe(true);
      expect(logs.some((line) => line.includes("Tests: 1 pass, 2 fail (3 total)"))).toBe(true);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  test("flags a non-zero bun exit even when every test passed", () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    try {
      const { exitCode } = printIntegrationSummary(
        { includedFiles: ["packages/a/__tests__/one.integration.test.ts"] },
        {
          totals: { pass: 1, fail: 0, tests: 1, files: 1 },
          exitCode: 3,
          noMatchingFiles: false,
        },
        "bulk",
      );

      expect(exitCode).toBe(1);
      expect(logs.some((line) => line.includes("bun test exited 3"))).toBe(true);
      expect(logs.some((line) => line.includes("Integration run FAILED."))).toBe(true);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });

  test("stays green on a clean single-file run", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    try {
      const { exitCode } = printIntegrationSummary(
        { includedFiles: ["packages/a/__tests__/one.integration.test.ts"] },
        {
          totals: { pass: 1, fail: 0, tests: 1, files: 1 },
          exitCode: 0,
          noMatchingFiles: false,
        },
        "bulk",
      );

      expect(exitCode).toBe(0);
      expect(logs.some((line) => line.includes("Integration run complete."))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});
