import { describe, expect, test } from "bun:test";
import { buildIntegrationTestArgs, selectIntegrationFiles } from "../integration-runner";

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
