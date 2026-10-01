import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project } from "ts-morph";
import { baselineCounts, createGuard, type Finding } from "../guard-raw-interactive-elements";

const BASELINE_FILE = ".kumiko-raw-interactive-elements-baseline.json";

// Each test gets an empty tmp baseline root; the repo's own baseline is never touched.
let baselineRoot: string;
let guard: ReturnType<typeof createGuard>;
beforeEach(() => {
  baselineRoot = mkdtempSync(path.join(tmpdir(), "raw-interactive-baseline-"));
  guard = createGuard({ baselineRoot });
});
afterEach(() => {
  rmSync(baselineRoot, { recursive: true, force: true });
});

function writeBaseline(perFile: Record<string, number>): void {
  writeFileSync(
    path.join(baselineRoot, BASELINE_FILE),
    JSON.stringify({ format: 1, generated: "2026-01-01", total: 0, perFile }),
  );
}

// Absolute path under process.cwd(): findings are keyed relative to ROOT
// (process.cwd()) — an in-memory path outside it would resolve to a
// "../.."-prefixed key instead of the repo-relative one the baseline expects.
function parse(source: string, file = "src/features/demo/web/ui.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(path.join(process.cwd(), file), source);
}

function runFor(source: string, file?: string): { warnings: string[]; violations: number } {
  const warnSpy = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const sf = parse(source, file);
    const outcome = guard.run([sf]);
    return { warnings, violations: outcome.violations.length };
  } finally {
    console.warn = warnSpy;
  }
}

const RELATIVE_TARGET_FILE = "src/features/demo/web/ui.tsx";

describe("guard-raw-interactive-elements", () => {
  test("flags a raw <a> with the Link replacement, when the file has primitives access", () => {
    const { warnings } = runFor(
      `import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
export function Nav() { return <a href="/x">go</a>; }`,
    );
    expect(warnings.some((w) => w.includes("raw <a>") && w.includes("usePrimitives().Link"))).toBe(
      true,
    );
  });

  test("flags raw <details>/<summary> with the CollapsibleSection replacement", () => {
    const { warnings } = runFor(
      `import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
export function ToolCard() {
	return (
		<details>
			<summary>more</summary>
			<pre>x</pre>
		</details>
	);
}`,
    );
    expect(
      warnings.some((w) => w.includes("raw <details>") && w.includes("CollapsibleSection")),
    ).toBe(true);
    expect(
      warnings.some((w) => w.includes("raw <summary>") && w.includes("CollapsibleSection")),
    ).toBe(true);
  });

  test("allows raw <a>/<details> without any primitives access in the file", () => {
    const { warnings } = runFor('export function LegacyLink() { return <a href="/x">go</a>; }');
    expect(warnings).toHaveLength(0);
  });

  test("a tag in a string literal or comment does not fire", () => {
    const { warnings } = runFor(
      `import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
// a <details> tag mentioned only in a comment
export function Snippet() {
	const label = "<a href=\\"x\\">not jsx</a>";
	return <div>{label}</div>;
}`,
    );
    expect(warnings).toHaveLength(0);
  });

  test("allows the framework Link primitive itself", () => {
    const { warnings } = runFor(
      `import { Link } from "@cosmicdrift/kumiko-renderer-web";
export function Nav() { return <Link href="/x">go</Link>; }`,
    );
    expect(warnings).toHaveLength(0);
  });

  test("ignore tag on the JSX element suppresses the finding", () => {
    const { warnings } = runFor(
      `import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
export function Nav() {
	// kumiko-lint-ignore raw-interactive-elements Migration folgt in enterprise#xyz
	return <a href="/x">go</a>;
}`,
    );
    expect(warnings).toHaveLength(0);
  });

  test("test files are skipped", () => {
    const { warnings } = runFor(
      `import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
export function Nav() { return <a href="/x">go</a>; }`,
      "src/features/demo/__tests__/ui.test.tsx",
    );
    expect(warnings).toHaveLength(0);
  });

  test("without a baseline file, a finding stays warning-only", () => {
    const { warnings, violations } = runFor(
      `import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
export function Nav() { return <a href="/x">go</a>; }`,
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(violations).toBe(0);
  });

  test("with a baseline, a new finding fails as a regression", () => {
    writeBaseline({});
    const { violations } = runFor(
      `import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
export function Nav() { return <a href="/x">go</a>; }`,
    );
    expect(violations).toBeGreaterThan(0);
  });

  test("with a baseline covering the existing count, no new violations", () => {
    writeBaseline({ [RELATIVE_TARGET_FILE]: 1 });
    const { violations } = runFor(
      `import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
export function Nav() { return <a href="/x">go</a>; }`,
    );
    expect(violations).toBe(0);
  });
});

describe("baselineCounts", () => {
  const finding = (file: string, line = 1, tag: Finding["tag"] = "a"): Finding => ({
    file,
    line,
    tag,
  });

  test("counts findings per file", () => {
    expect(
      baselineCounts([
        finding("src/features/demo/web/a.tsx"),
        finding("src/features/demo/web/a.tsx", 9, "details"),
      ]),
    ).toEqual({ "src/features/demo/web/a.tsx": 2 });
  });
});
