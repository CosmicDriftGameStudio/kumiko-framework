import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { Project } from "ts-morph";
import { guard } from "../guard-no-custom-primitives";

// Absolute path under process.cwd(): the guard keys its raw-form-html
// findings by `path.relative(cwd, file)` for the baseline. A relative
// in-memory path like "src/..." lands at "/src/..." in ts-morph, which
// would resolve to a "../../..."-prefixed key instead of the expected
// repo-relative one.
function parse(source: string, file = "src/features/demo/web/ui.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(path.join(process.cwd(), file), source);
}

describe("guard-no-custom-primitives", () => {
  test("flags a function declaration with a primitive suffix", () => {
    const sf = parse("export function SectionCard() { return <div />; }");
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("SectionCard");
  });

  test("flags arrow components (StatusBadge, ProgressBar, UptimeChart)", () => {
    const sf = parse(
      `export const StatusBadge = () => <span />;
export const ProgressBar = () => <div />;
export const UptimeChart = () => <svg />;`,
    );
    expect(guard.run([sf]).violations).toHaveLength(3);
  });

  test("allows domain components without a primitive name", () => {
    const sf = parse(
      `export function CreditCalculatorScreen() { return <div />; }
export const IncidentTimeline = () => <div />;`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("allows lowercase functions (not components)", () => {
    const sf = parse("export function buildTable() { return []; }");
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("ignore tag allows a justified domain exception", () => {
    const sf = parse(
      `// kumiko-lint-ignore no-custom-primitives Domain-Karte ohne Framework-Pendant, Refactor in mh#219
export function RefinanceCreditCard() { return <div />; }`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  describe("raw form HTML (infra#748)", () => {
    test("flags <input> when the file imports from kumiko-renderer-web", () => {
      const sf = parse(
        `import { Field } from "@cosmicdrift/kumiko-renderer-web";
export function ClarifyForm() { return <Field><input value="x" /></Field>; }`,
      );
      const violations = guard.run([sf]).violations;
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("raw form HTML");
    });

    test("flags <select>, <textarea> and <label> in a file with primitives access", () => {
      const sf = parse(
        `import { Field } from "@cosmicdrift/kumiko-renderer-web";
export function ClarifyForm() {
	return (
		<Field>
			<label>Reason</label>
			<select><option value="a">a</option></select>
			<textarea />
		</Field>
	);
}`,
      );
      const violations = guard.run([sf]).violations;
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("raw form HTML");
    });

    test("flags a usePrimitives() import from kumiko-renderer (not just -web)", () => {
      const sf = parse(
        `import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
export function ProposalPanel() {
	const { Button } = usePrimitives();
	return <div><input value="x" /><Button /></div>;
}`,
      );
      const violations = guard.run([sf]).violations;
      expect(violations).toHaveLength(1);
    });

    test("flags raw form HTML even with no primitives import at all (import-independent)", () => {
      const sf = parse('export function LegacyForm() { return <input value="x" />; }');
      const violations = guard.run([sf]).violations;
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("raw form HTML");
    });

    test("flags raw form HTML when only kumiko-renderer (types) instead of -renderer-web is imported — the designer gap (infra#748 follow-up)", () => {
      const sf = parse(
        `import type { FormFieldSpec } from "@cosmicdrift/kumiko-framework/engine";
export function PatternForm() { return <input value="x" />; }`,
      );
      const violations = guard.run([sf]).violations;
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("raw form HTML");
    });

    test("ignore tag on the JSX element suppresses the finding", () => {
      const sf = parse(
        `import { Field } from "@cosmicdrift/kumiko-renderer-web";
export function LegacyBridgeForm() {
	// kumiko-lint-ignore no-custom-primitives Migration folgt in mh#219
	return <input value="x" />;
}`,
      );
      expect(guard.run([sf]).violations).toHaveLength(0);
    });
  });
});
