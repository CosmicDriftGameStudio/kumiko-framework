import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseStepArgs, resolvePoolSize, runLanes } from "../run-steps-parallel";

const RUNNER = join(import.meta.dir, "..", "run-steps-parallel.ts");

describe("parseStepArgs", () => {
  test("--then appends to the previous lane, --step opens a new one", () => {
    expect(
      parseStepArgs([
        "--fail-prefix",
        "failed:",
        "--step",
        "test",
        "bun run test",
        "--then",
        "test:dom",
        "bun run test:dom",
        "--step",
        "guards",
        "kumiko-guards guards",
      ]),
    ).toEqual({
      failPrefix: "failed:",
      lanes: [
        [
          { label: "test", cmd: "bun run test" },
          { label: "test:dom", cmd: "bun run test:dom" },
        ],
        [{ label: "guards", cmd: "kumiko-guards guards" }],
      ],
    });
  });

  test("rejects an unknown flag and a step without a command", () => {
    expect(() => parseStepArgs(["--parallel"])).toThrow('unknown argument "--parallel"');
    expect(() => parseStepArgs(["--step", "test"])).toThrow("--step needs <label> <cmd>");
  });
});

describe("resolvePoolSize", () => {
  test("an explicit positive override wins", () => {
    expect(resolvePoolSize("3", 12, 0)).toBe(3);
  });

  test("ignores an invalid override and sizes to the free capacity", () => {
    expect(resolvePoolSize("zero", 12, 2)).toBe(10);
    expect(resolvePoolSize(undefined, 12, 0)).toBe(11);
  });

  test("keeps four lanes on a saturated machine, capped below the core count", () => {
    expect(resolvePoolSize(undefined, 12, 17)).toBe(4);
    expect(resolvePoolSize(undefined, 4, 9)).toBe(3);
    expect(resolvePoolSize(undefined, 1, 0)).toBe(1);
  });
});

describe("runLanes", () => {
  test("every step runs after a failure, results keep the declared order", async () => {
    const results = await runLanes(
      [
        [
          { label: "a", cmd: "exit 3" },
          { label: "b", cmd: "echo after-a" },
        ],
        [{ label: "c", cmd: "echo c-out" }],
      ],
      2,
      () => {},
    );

    expect(results.map((result) => [result.label, result.exitCode])).toEqual([
      ["a", 3],
      ["b", 0],
      ["c", 0],
    ]);
    expect(results[1]?.output).toBe("after-a\n");
  });

  test("lanes run concurrently up to the pool size", async () => {
    const started = performance.now();
    await runLanes(
      [[{ label: "x", cmd: "sleep 1" }], [{ label: "y", cmd: "sleep 1" }]],
      2,
      () => {},
    );
    expect(performance.now() - started).toBeLessThan(1900);
  });

  test("each step's output is logged as one block with its status line", async () => {
    const logged: string[] = [];
    await runLanes([[{ label: "noisy", cmd: "echo one; echo two >&2; exit 1" }]], 1, (text) =>
      logged.push(text),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^\[pre-push\] ✗ noisy \(\d+\.\ds\)\none\ntwo\n$/);
  });
});

describe("run-steps-parallel CLI", () => {
  test("exits 1 and names the failed steps in declared order after the prefix", () => {
    const result = Bun.spawnSync([
      "bun",
      RUNNER,
      "--fail-prefix",
      "check failed:",
      "--step",
      "ok",
      "true",
      "--step",
      "late",
      "sleep 0.3; exit 1",
      "--step",
      "early",
      "exit 1",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("check failed: late early");
  });
});
