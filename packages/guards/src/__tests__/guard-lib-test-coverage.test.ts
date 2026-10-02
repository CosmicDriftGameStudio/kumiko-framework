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
  test("exportierte Funktion mit verknüpftem, referenzierendem Test → grün", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base * 1.02; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../calc";
addFees(100);`,
      }),
    ).toHaveLength(0);
  });

  test("exportierte Funktion ohne jeden Test → Datei-Verstoß", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base * 1.02; }`,
      }),
    ).toEqual([expect.stringContaining("Kein Test importiert dieses lib-Modul")]);
  });

  test("verknüpfter Test, aber Funktion nicht referenziert → Funktions-Verstoß", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base; }
export function subFees(base: number): number { return base; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../calc";
addFees(1);`,
      }),
    ).toEqual([expect.stringContaining('"subFees"')]);
  });

  test("Test importiert die lib per NodeNext-.js-Spezifizierer → gilt als verknüpft", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base * 1.02; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../calc.js";
addFees(100);`,
      }),
    ).toHaveLength(0);
  });

  test("Fixture unter __tests__ ohne .test-Suffix ersetzt keinen Test → Verstoß bleibt", () => {
    expect(
      run({
        "/src/lib/calc.ts": `export function addFees(base: number): number { return base; }`,
        "/src/lib/__tests__/fixtures.ts": `import { addFees } from "../calc";
export const sample = addFees(1);`,
      }),
    ).toEqual([expect.stringContaining("Kein Test importiert dieses lib-Modul")]);
  });

  test("Fixture unter __tests__ selbst ist keine lib-Quelle", () => {
    expect(
      run({
        "/src/lib/__tests__/fixtures.ts": `export function makeSample(): number { return 1; }`,
      }),
    ).toHaveLength(0);
  });

  test("tsx-lib mit exportierter Funktion ohne Test → Verstoß", () => {
    expect(
      run({
        "/src/lib/foo.tsx": `export function renderFoo(): number { return 1; }`,
      }),
    ).toEqual([expect.stringContaining("Kein Test importiert dieses lib-Modul")]);
  });

  test("Scan-Scope erfasst .tsx und verschachtelte lib-Ebenen", () => {
    const within = guard.scan.scope === "source" ? (guard.scan.within ?? []) : [];
    const matches = (p: string) => within.some((g) => new Bun.Glob(g).match(p));
    expect(matches("lib/foo.tsx")).toBe(true);
    expect(matches("features/a/lib/deep/foo.ts")).toBe(true);
    expect(matches("app/screens/lib/foo.tsx")).toBe(true);
    expect(matches("features/a/views/foo.ts")).toBe(false);
  });

  test("Test importiert ein anderes Modul → gilt nicht als verknüpft", () => {
    expect(
      run({
        [LIB]: `export function addFees(base: number): number { return base; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import { addFees } from "../other";
addFees(1);`,
      }),
    ).toEqual([expect.stringContaining("Kein Test importiert dieses lib-Modul")]);
  });

  test("Test eine Ebene über lib/ (features/<x>/__tests__ → ../lib/calc) zählt", () => {
    expect(
      run({
        [LIB]: `export function markdownPlainTextLength(md: string): number { return md.length; }`,
        "/src/features/demo/__tests__/intro.test.ts": `import { markdownPlainTextLength } from "../lib/calc";
markdownPlainTextLength("x");`,
      }),
    ).toHaveLength(0);
  });

  test("arrow-fn-Export ohne Referenz → Verstoß", () => {
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
  test("Datei ohne exportierte Funktion (nur Typ/Konstante) → ausgenommen", () => {
    expect(
      run({
        "/src/lib/finance-colors.ts": `export const FINANCE_COLOR = { debt: "var(--x)" } as const;
export type FinanceRole = keyof typeof FINANCE_COLOR;`,
      }),
    ).toHaveLength(0);
  });

  test("ignore-Tag auf IO-Loader nimmt die Funktion aus", () => {
    expect(
      run({
        [LIB]: `// kumiko-lint-ignore lib-test-coverage integration-covered via public-share.integration.test.ts
export async function loadRows(db: unknown): Promise<unknown[]> { return []; }`,
      }),
    ).toHaveLength(0);
  });

  test("alle Funktionen ge-ignore-tagged → Datei braucht keinen Test", () => {
    expect(
      run({
        [LIB]: `// kumiko-lint-ignore lib-test-coverage integration-covered
export async function loadRows(db: unknown): Promise<unknown[]> { return []; }
// kumiko-lint-ignore lib-test-coverage integration-covered
export async function loadOne(db: unknown): Promise<unknown> { return null; }`,
      }),
    ).toHaveLength(0);
  });

  test("Testdateien selbst werden nicht als lib-Quelle geprüft", () => {
    expect(
      run({
        "/src/lib/__tests__/x.test.ts": `export function helper(): number { return 1; }`,
      }),
    ).toHaveLength(0);
  });

  test("ignore-Tag auf einem arrow-const-Export nimmt die Funktion aus (hasIgnoreTag laeuft gegen die VariableDeclaration-Zeile, nicht nur FunctionDeclaration)", () => {
    expect(
      run({
        [LIB]: `// kumiko-lint-ignore lib-test-coverage integration-covered via public-share.integration.test.ts
export const loadRows = async (db: unknown): Promise<unknown[]> => { return []; };`,
      }),
    ).toHaveLength(0);
  });

  test("named import ohne Nutzung im Testkörper zaehlt NICHT als Referenz (nach Fix: Funktions-Verstoß, nicht grün)", () => {
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
  test("export default function wird als exportierte Callable erfasst", () => {
    expect(
      run({
        [LIB]: `export default function addFees(base: number): number { return base * 1.02; }`,
      }),
    ).toEqual([expect.stringContaining("Kein Test importiert dieses lib-Modul")]);
  });

  test("export default function mit verknüpftem, referenzierendem Test → grün", () => {
    expect(
      run({
        [LIB]: `export default function addFees(base: number): number { return base * 1.02; }`,
        "/src/features/demo/lib/__tests__/calc.test.ts": `import addFees from "../calc";
addFees(100);`,
      }),
    ).toHaveLength(0);
  });
});

describe("guard-lib-test-coverage — Namen mit $", () => {
  const TEST = "/src/features/demo/lib/__tests__/calc.test.ts";

  test("export format$ wird durch eine Referenz auf format$ abgedeckt", () => {
    expect(
      run({
        [LIB]: `export function format$(base: number): number { return base; }`,
        [TEST]: `import { format$ } from "../calc";
format$(1);`,
      }),
    ).toHaveLength(0);
  });

  test("Referenz auf format$ deckt den Export format nicht ab", () => {
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
