import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project } from "ts-morph";
import { baselineRatchet } from "../_lib/guard-kit";
import { analyse, HARD_COMPLEXITY_CAP } from "../check-complexity";
import { fixtureRoot } from "./parent-workspace-fixture";

const ROOTS = [
  fixtureRoot("fixture-framework", "/repo", {
    kind: "framework",
    sourceRoots: ["packages/*/src"],
    testGlobs: ["packages/*/src/**/*.test.ts"],
  }),
];
const FILE = "packages/a/src/big.ts";
const BUDGET_TAG = ["kumiko-lint-ignore", "complexity-budget"].join(" ");

const tempDir = mkdtempSync(path.join(tmpdir(), "check-complexity-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

function functionWithComplexity(complexity: number, tagged: boolean): string {
  const branches = Array.from(
    { length: complexity - 1 },
    (_, i) => `  if (x === ${i}) return ${i};`,
  );
  const tag = tagged ? `// ${BUDGET_TAG} fixture\n` : "";
  return `${tag}export function big(x: number): number {\n${branches.join("\n")}\n  return -1;\n}\n`;
}

function analyseFixture(
  code: string,
  withBaseline: boolean,
  compareBaseline = true,
  file: string = FILE,
) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(`/repo/${file}`, code);
  const ratchet = baselineRatchet({
    file: path.join(tempDir, `baseline-${Math.random().toString(36).slice(2)}.json`),
    formatVersion: 1,
    unit: "Complexity-Hotspot(s)",
  });
  if (withBaseline) ratchet.write({ [file]: 1 });
  return analyse([sf], ROOTS, compareBaseline, { ratchet }).violations;
}

describe("Complexity guard hard cap", () => {
  test("a tagged, baselined function above the cap is still a violation", () => {
    const violations = analyseFixture(functionWithComplexity(HARD_COMPLEXITY_CAP + 1, true), true);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: FILE, neverFrozen: true });
    expect(violations[0]?.message).toContain(`complexity ${HARD_COMPLEXITY_CAP + 1}`);
  });

  test("a tagged, baselined function exactly at the cap passes", () => {
    expect(analyseFixture(functionWithComplexity(HARD_COMPLEXITY_CAP, true), true)).toEqual([]);
  });

  test("an untagged function above the cap fails even when the baseline covers its hotspot", () => {
    const violations = analyseFixture(functionWithComplexity(HARD_COMPLEXITY_CAP + 1, false), true);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.neverFrozen).toBe(true);
  });

  test("the cap also applies when the baseline comparison is skipped", () => {
    const code = functionWithComplexity(HARD_COMPLEXITY_CAP + 1, true);
    expect(analyseFixture(code, false, false)).toHaveLength(1);
  });

  test("conditional JSX in a .tsx component counts toward the cap", () => {
    const file = "packages/a/src/big-screen.tsx";
    const slots = Array.from(
      { length: HARD_COMPLEXITY_CAP },
      (_, i) => `      {x === ${i} && <span>${i}</span>}`,
    );
    const code = `export function BigScreen({ x }: { x: number }) {\n  return (\n    <div>\n${slots.join("\n")}\n    </div>\n  );\n}\n`;
    const violations = analyseFixture(code, false, true, file);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file, neverFrozen: true });
    expect(violations[0]?.message).toContain(`complexity ${HARD_COMPLEXITY_CAP + 1}`);
  });
});
