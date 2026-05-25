import { describe, expect, test } from "bun:test";
import { parseBunTestRunOutput } from "../integration-test";
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

describe("printIntegrationSummary", () => {
  test("flags file/dir mismatches and failing dirs", () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    try {
      const { exitCode } = printIntegrationSummary(
        {
          includedFiles: ["packages/a/__tests__/one.integration.test.ts"],
          excludedFiles: [{ file: "samples/x.integration.test.ts", prefix: "samples/" }],
          includedDirs: ["packages/a/__tests__"],
        },
        [
          {
            kind: "ran",
            dir: "./packages/a/__tests__",
            totals: { pass: 1, fail: 2, tests: 3, files: 1 },
          },
          { kind: "skipped", dir: "./packages/b/__tests__", reason: "no discoverable tests" },
        ],
      );

      expect(exitCode).toBe(1);
      expect(logs.some((line) => line.includes("Files: 1/1 executed"))).toBe(true);
      expect(logs.some((line) => line.includes("Dirs:  1/1 executed (1 skipped)"))).toBe(true);
      expect(logs.some((line) => line.includes("Tests: 1 pass, 2 fail (3 total)"))).toBe(true);
      expect(logs.some((line) => line.includes("Failed in 1 director"))).toBe(true);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});
