import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-lib-test-coverage";

function run(fileset: Record<string, string>): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, source] of Object.entries(fileset)) {
    project.createSourceFile(path, source);
  }
  return guard.run(project.getSourceFiles()).violations.map((v) => v.message);
}

const LIB = "/src/features/demo/lib/calc.ts";

describe("guard-lib-test-coverage — verlangt Test + namentliche Referenz", () => {
  test("exported function with a linked, referencing test → green", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base * 1.02; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../calc";
addFees(100);`,
      }),
    ).toHaveLength(0);
  });

  test("exported function without any test → file violation", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base * 1.02; }`,
      }),
    ).toEqual([expect.stringContaining("No test imports this lib module")]);
  });

  test("linked test, but function not referenced → function violation", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base; }
export function subFees(base: number): number { return base; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../calc";
addFees(1);`,
      }),
    ).toEqual([expect.stringContaining('"subFees"')]);
  });

  test("test imports the lib via a NodeNext .js specifier → counts as linked", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base * 1.02; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../calc.js";
addFees(100);`,
      }),
    ).toHaveLength(0);
  });

  test("fixture under __tests__ without a .test suffix does not replace a test → violation remains", () => {
    expect(
      run({
        "/src/lib/calc.ts": `export function addFees(base: number): number { return base; }`,
        "/src/lib/__tests__/fixtures.ts": `import { addFees } from "../calc";
export const sample = addFees(1);`,
      }),
    ).toEqual([expect.stringContaining("No test imports this lib module")]);
  });

  test("fixture under __tests__ itself is not a lib source", () => {
    expect(
      run({
        "/src/lib/__tests__/fixtures.ts": `export function makeSample(): number { return 1; }`,
      }),
    ).toHaveLength(0);
  });

  test("tsx lib with exported function without a test → violation", () => {
    expect(
      run({
        "/src/lib/foo.tsx": `export function renderFoo(): number { return 1; }`,
      }),
    ).toEqual([expect.stringContaining("No test imports this lib module")]);
  });

  test("scan scope includes .tsx and nested lib levels", () => {
    const within = guard.scan.scope === "source" ? (guard.scan.within ?? []) : [];
    const matches = (p: string) => within.some((g) => new Bun.Glob(g).match(p));
    expect(matches("lib/foo.tsx")).toBe(true);
    expect(matches("features/a/lib/deep/foo.ts")).toBe(true);
    expect(matches("app/screens/lib/foo.tsx")).toBe(true);
    expect(matches("features/a/views/foo.ts")).toBe(false);
  });

  test("test imports another module → does not count as linked", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../other";
addFees(1);`,
      }),
    ).toEqual([expect.stringContaining("No test imports this lib module")]);
  });

  test("test one level above lib/ (features/<x>/__tests__ → ../lib/calc) counts", () => {
    expect(
      run({
        [LIB]: `export function markdownPlainTextLength(md: string): number { return md.length; }`,
        "/src/features/demo/__tests__/intro.test.ts": `import { markdownPlainTextLength } from "../lib/calc";
markdownPlainTextLength("x");`,
      }),
    ).toHaveLength(0);
  });

  test("arrow-fn export without a reference → violation", () => {
    expect(
      run({
        [LIB]: `export const addFees = (b: number): number => b * 1.02;`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { other } from "../calc";
other();`,
      }),
    ).toEqual([expect.stringContaining('"addFees"')]);
  });
});

describe("guard-lib-test-coverage — Ausnahmen", () => {
  test("file without an exported function (type/constant only) → exempt", () => {
    expect(
      run({
        "/src/lib/finance-colors.ts": `export const FINANCE_COLOR = { debt: "var(--x)" } as const;
export type FinanceRole = keyof typeof FINANCE_COLOR;`,
      }),
    ).toHaveLength(0);
  });

  test("ignore tag on IO-Loader excludes the function", () => {
    expect(
      run({
        [LIB]: `// kumiko-lint-ignore lib-test-coverage integration-covered via public-share.integration.test.ts
export async function loadRows(db: unknown): Promise<unknown[]> { return []; }`,
      }),
    ).toHaveLength(0);
  });

  test("all functions are ignore-tagged → file needs no test", () => {
    expect(
      run({
        [LIB]: `// kumiko-lint-ignore lib-test-coverage integration-covered
export async function loadRows(db: unknown): Promise<unknown[]> { return []; }
// kumiko-lint-ignore lib-test-coverage integration-covered
export async function loadOne(db: unknown): Promise<unknown> { return null; }`,
      }),
    ).toHaveLength(0);
  });

  test("test files themselves are not checked as lib sources", () => {
    expect(
      run({
        "/src/lib/__tests__/x.test.ts": `export function helper(): number { return 1; }`,
      }),
    ).toHaveLength(0);
  });

  test("ignore tag on an arrow-const export excludes the function (hasIgnoreTag runs against the VariableDeclaration line, not just FunctionDeclaration)", () => {
    expect(
      run({
        [LIB]: `// kumiko-lint-ignore lib-test-coverage integration-covered via public-share.integration.test.ts
export const loadRows = async (db: unknown): Promise<unknown[]> => { return []; };`,
      }),
    ).toHaveLength(0);
  });

  test("named import unused in the test body does NOT count as a reference (after fix: function violation, not green)", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base * 1.02; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../calc";
test("unrelated", () => { expect(1).toBe(1); });`,
      }),
    ).toEqual([expect.stringContaining('"addFees"')]);
  });
});

describe("guard-lib-test-coverage — export default function (coverage-gap fix)", () => {
  test("export default function is detected as an exported callable", () => {
    expect(
      run({
        [LIB]: `export default function addFees(base: number): number { return base * 1.02; }`,
      }),
    ).toEqual([expect.stringContaining("No test imports this lib module")]);
  });

  test("export default function with a linked, referencing test → green", () => {
    expect(
      run({
        [LIB]: `export default function addFees(base: number): number { return base * 1.02; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import addFees from "../calc";
addFees(100);`,
      }),
    ).toHaveLength(0);
  });
});

describe("guard-lib-test-coverage — names with $", () => {
  const TEST = "/src/features/demo/lib/__tests__/calc.test.ts";

  test("export format$ is covered by a reference to format$", () => {
    expect(
      run({
        [LIB]: `export function format$(base: number): number { return base; }`,
        [TEST]: `import { format$ } from "../calc";
format$(1);`,
      }),
    ).toHaveLength(0);
  });

  test("a reference to format$ does not cover the format export", () => {
    expect(
      run({
        [LIB]: `export function format(base: number): number { return base; }
export function format$(base: number): number { return base; }`,
        [TEST]: `import { format$ } from "../calc";
format$(1);`,
      }),
    ).toEqual([expect.stringContaining("format")]);
  });
});
