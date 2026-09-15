import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-no-logic-in-views";

function parse(source: string, file = "src/features/demo/web/x.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(file, source);
}

function flagged(source: string): string[] {
  return guard.run([parse(source)]).violations.map((v) => v.message);
}

describe("guard-no-logic-in-views — flags real view logic", () => {
  // The 6 real money-horse functions that belong in lib/.
  test("paidFraction (control flow + computation)", () => {
    expect(
      flagged(`function paidFraction(principal: number, remaining: number): number {
  if (principal <= 0) return 0;
  return Math.max(0, Math.min(1, (principal - remaining) / principal));
}`),
    ).toHaveLength(1);
  });

  test("parseTxLines (local bindings + map)", () => {
    expect(
      flagged(`function parseTxLines(raw: unknown): { readonly amount: number }[] {
  const arr = typeof raw === "string" ? [] : Array.isArray(raw) ? raw : [];
  return arr.map((l) => ({ amount: Number((l as Record<string, unknown>)?.["amount"] ?? 0) }));
}`),
    ).toHaveLength(1);
  });

  test("safeJsonArray (try/catch)", () => {
    expect(
      flagged(`function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}`),
    ).toHaveLength(1);
  });

  test("withWindfall (bindings + if + ternary)", () => {
    expect(
      flagged(`function withWindfall(refinance: BausparRefinance, windfall: number): WindfallOutcome {
  const proj = calcBauspar({ ...refinance.input, guthaben: refinance.input.guthaben + windfall });
  if (!proj.reachesAllotment) return { kind: "never" };
  const monthsLate = monthIndex(proj.allotmentDate) - monthIndex(refinance.targetEnd);
  return monthsLate <= 0 ? { kind: "inTime" } : { kind: "late", monthsLate };
}`),
    ).toHaveLength(1);
  });

  test("summarize (single return, but a domain call)", () => {
    expect(
      flagged(`function summarize(s: ScenarioDraft, rentalIncome: number): ScenarioSummary {
  return summarizeScenario({ sum: s.sum as number, interest: s.interest as number });
}`),
    ).toHaveLength(1);
  });

  test("bestIndex (let + forEach)", () => {
    expect(
      flagged(`function bestIndex(values: ReadonlyArray<number | null>): number {
  let best = -1;
  let min = Number.POSITIVE_INFINITY;
  values.forEach((v, i) => { if (v !== null && v < min) { min = v; best = i; } });
  return best;
}`),
    ).toHaveLength(1);
  });
});

describe("guard-no-logic-in-views — lets legitimate shapes through", () => {
  test("type guard (x is T) stays allowed", () => {
    expect(
      flagged(`function isNum(value: number | undefined): value is number {
  return typeof value === "number" && value > 0;
}`),
    ).toHaveLength(0);
  });

  test("single-return predicate without a call stays allowed", () => {
    expect(
      flagged(`function isComplete(s: ScenarioDraft): boolean {
  return (
    typeof s.sum === "number" && s.sum > 0 &&
    typeof s.interest === "number" && s.interest > 0 &&
    typeof s.repayment === "number"
  );
}`),
    ).toHaveLength(0);
  });

  test("boolean predicate with a primitive method (.trim()) stays allowed", () => {
    expect(
      flagged(`function isComplete(d: BausparDraft): boolean {
  return d.name.trim().length > 0 && (d.bausparsumme ?? 0) > 0 && d.start.length > 0;
}`),
    ).toHaveLength(0);
  });

  test("component (JSX return) stays allowed", () => {
    expect(
      flagged(`export function RefinanceVerdict({ refinance }: { refinance: X }): ReactNode {
  const proj = compute(refinance);
  return <div>{proj.value}</div>;
}`),
    ).toHaveLength(0);
  });

  test("PascalCase cell renderer without a JSX element stays allowed (component)", () => {
    expect(
      flagged(`function EuroCell({ value }: { value: number }): ReactNode {
  return formatEuro(value);
}`),
    ).toHaveLength(0);
  });

  test("hook (use*) stays allowed", () => {
    expect(
      flagged(`function useOptimizer(input: number): number {
  const [state, setState] = useState(input);
  return state * 2;
}`),
    ).toHaveLength(0);
  });

  test("expression-bodied arrow predicate stays allowed", () => {
    expect(flagged("const isPositive = (v: number) => v > 0;")).toHaveLength(0);
  });

  test("nested helper inside a component is not captured (top-level only)", () => {
    expect(
      flagged(`export function Screen(): ReactNode {
  function handleClick() { const x = compute(); return x + 1; }
  return <button onClick={handleClick} />;
}`),
    ).toHaveLength(0);
  });
});

describe("guard-no-logic-in-views — exceptions & scope", () => {
  test("ignore tag on the previous line allows a justified exception", () => {
    expect(
      flagged(`// kumiko-lint-ignore no-logic-in-views Hot-Path, bewusst inline
function bestIndex(values: number[]): number {
  let best = -1;
  values.forEach((v, i) => { if (v > best) best = i; });
  return best;
}`),
    ).toHaveLength(0);
  });

  test("test files are skipped", () => {
    const sf = parse(
      "function compute(): number { const x = 1; return x + 1; }",
      "src/features/demo/web/__tests__/x.test.tsx",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test(".integration.tsx is skipped (EXCLUDE applies via sf.getFilePath())", () => {
    const sf = parse(
      "function compute(): number { const x = 1; return x + 1; }",
      "src/features/demo/web/x.integration.tsx",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("ignore tag inline on the same line as the function declaration allows the exception", () => {
    expect(
      flagged(`function bestIndex(values: number[]): number { // kumiko-lint-ignore no-logic-in-views Hot-Path, bewusst inline
  let best = -1;
  values.forEach((v, i) => { if (v > best) best = i; });
  return best;
}`),
    ).toHaveLength(0);
  });
});
