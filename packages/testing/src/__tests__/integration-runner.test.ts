import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildIntegrationTestArgs,
  listIntegrationTestFiles,
  resolveRequestedIntegrationFiles,
  selectIntegrationFiles,
} from "../integration-runner";

describe("buildIntegrationTestArgs", () => {
  test("without options sets no parallelism and no timings", () => {
    expect(buildIntegrationTestArgs({ files: ["a.integration.test.ts"] })).toEqual([
      "test",
      "--config=bunfig.integration.toml",
      "--timeout=15000",
      "a.integration.test.ts",
    ]);
  });

  test("adds --parallel and --timings when asked", () => {
    expect(
      buildIntegrationTestArgs({
        files: ["a.integration.test.ts", "b.integration.test.ts"],
        parallel: 4,
        timings: ".timings.json",
      }),
    ).toEqual([
      "test",
      "--config=bunfig.integration.toml",
      "--timeout=15000",
      "--parallel=4",
      "--no-isolate",
      "--timings=.timings.json",
      "a.integration.test.ts",
      "b.integration.test.ts",
    ]);
  });

  test("--update-timings is passed through with a timings file", () => {
    expect(
      buildIntegrationTestArgs({ files: [], timings: "t.json", updateTimings: true }),
    ).toContain("--update-timings");
  });

  test("rejects a non-positive or fractional --parallel", () => {
    for (const parallel of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildIntegrationTestArgs({ files: [], parallel })).toThrow(
        /--parallel must be a positive integer/,
      );
    }
  });

  test("rejects --update-timings without a timings file", () => {
    expect(() => buildIntegrationTestArgs({ files: [], updateTimings: true })).toThrow(
      /--update-timings needs --timings/,
    );
  });

  test("emits --no-isolate exactly when --parallel is set", () => {
    const withParallel = [{ parallel: 1 }, { parallel: 2, timings: "t.json", updateTimings: true }];
    for (const combo of withParallel) {
      expect(buildIntegrationTestArgs({ files: ["x.integration.test.ts"], ...combo })).toContain(
        "--no-isolate",
      );
    }
    for (const combo of [{}, { timings: "t.json" }]) {
      expect(
        buildIntegrationTestArgs({ files: ["x.integration.test.ts"], ...combo }),
      ).not.toContain("--no-isolate");
    }
  });
});

describe("resolveRequestedIntegrationFiles", () => {
  test("resolves each positional against cwd into an absolute path", () => {
    expect(
      resolveRequestedIntegrationFiles(
        "/repo",
        ["a.integration.test.ts", "src/b.integration.test.ts"],
        () => true,
      ),
    ).toEqual(["/repo/a.integration.test.ts", "/repo/src/b.integration.test.ts"]);
  });

  test("leaves an already-absolute positional untouched", () => {
    expect(
      resolveRequestedIntegrationFiles("/repo", ["/other/c.integration.test.ts"], () => true),
    ).toEqual(["/other/c.integration.test.ts"]);
  });

  test("throws on the first file that does not exist", () => {
    expect(() =>
      resolveRequestedIntegrationFiles("/repo", ["missing.integration.test.ts"], () => false),
    ).toThrow(/file not found: missing\.integration\.test\.ts/);
  });

  test("a directory expands to its integration test files only, not *.test.tsx or unit tests", () => {
    const listed = [
      "a.integration.test.ts",
      "ui.test.tsx",
      "unit.test.ts",
      "deep/b.integration.test.ts",
    ];
    expect(
      resolveRequestedIntegrationFiles(
        "/repo",
        ["src"],
        () => true,
        () => listed,
      ),
    ).toEqual(["/repo/src/a.integration.test.ts", "/repo/src/deep/b.integration.test.ts"]);
  });

  test("an ancestor named e2e or dist does not filter out the directory's files", () => {
    expect(
      resolveRequestedIntegrationFiles(
        "/work/e2e/app",
        ["src"],
        () => true,
        () => ["a.integration.test.ts"],
      ),
    ).toEqual(["/work/e2e/app/src/a.integration.test.ts"]);
  });

  test("a real directory expands without descending into node_modules, dist or e2e", () => {
    const root = mkdtempSync(join(tmpdir(), "kumiko-int-dir-"));
    try {
      for (const file of [
        "src/a.integration.test.ts",
        "src/ui.test.tsx",
        "src/node_modules/dep/x.integration.test.ts",
        "src/e2e/y.integration.test.ts",
      ]) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), "");
      }
      expect(resolveRequestedIntegrationFiles(root, ["src"])).toEqual([
        join(root, "src", "a.integration.test.ts"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a file positional is passed through as-is", () => {
    expect(
      resolveRequestedIntegrationFiles(
        "/repo",
        ["x.test.ts"],
        () => true,
        () => undefined,
      ),
    ).toEqual(["/repo/x.test.ts"]);
  });

  test("empty positionals resolve to an empty list", () => {
    expect(resolveRequestedIntegrationFiles("/repo", [], () => false)).toEqual([]);
  });
});

describe("selectIntegrationFiles", () => {
  test("keeps only integration test files outside node_modules, dist and e2e, sorted", () => {
    expect(
      selectIntegrationFiles([
        "src/b/z.integration.test.ts",
        "src/a/y.integration.test.ts",
        "src/a/unit.test.ts",
        "src/a/real.real.test.ts",
        "node_modules/pkg/x.integration.test.ts",
        "packages/p/dist/x.integration.test.ts",
        "e2e/flow.integration.test.ts",
        "src/e2e/flow.integration.test.ts",
      ]),
    ).toEqual(["src/a/y.integration.test.ts", "src/b/z.integration.test.ts"]);
  });
});

describe("listIntegrationTestFiles", () => {
  test("finds nested integration tests and never descends into excluded or dot directories", () => {
    const root = mkdtempSync(join(tmpdir(), "integration-files-"));
    try {
      for (const file of [
        "src/a/y.integration.test.ts",
        "src/a/unit.test.ts",
        "top.integration.test.ts",
        "node_modules/pkg/x.integration.test.ts",
        "dist/x.integration.test.ts",
        "src/e2e/flow.integration.test.ts",
        ".worktree/x.integration.test.ts",
      ]) {
        mkdirSync(join(root, dirname(file)), { recursive: true });
        writeFileSync(join(root, file), "");
      }
      expect(listIntegrationTestFiles(root).sort()).toEqual([
        "src/a/y.integration.test.ts",
        "top.integration.test.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
