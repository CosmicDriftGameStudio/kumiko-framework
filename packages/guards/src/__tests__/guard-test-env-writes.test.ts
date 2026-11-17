import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { testEnvWriteCounts } from "../guard-test-env-writes";

const ROOTS = [{ absPath: "/repo" }];

function countsFor(code: string): Record<string, number> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/repo/packages/a/src/__tests__/x.test.ts", code);
  return testEnvWriteCounts([sf], ROOTS);
}

describe("test-env-writes guard", () => {
  test("counts assignments, delete and Object.assign on process.env / Bun.env", () => {
    const counts = countsFor(
      [
        'process.env.A = "1";',
        'process.env["B"] ??= "x";',
        "delete process.env.C;",
        'Bun.env.D = "1";',
        'Object.assign(process.env, { E: "1" });',
      ].join("\n"),
    );
    expect(counts).toEqual({ "packages/a/src/__tests__/x.test.ts": 5 });
  });

  test("does not count reads or withEnv", () => {
    const counts = countsFor(
      [
        "declare function withEnv(o: object, f: () => void): Promise<void>;",
        "const v = process.env.A;",
        'if (process.env.B === "x") {}',
        'await withEnv({ A: "1" }, () => {});',
      ].join("\n"),
    );
    expect(counts).toEqual({});
  });
});
