import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { findWeakIgnoreReasons, weakIgnoreReasonCounts } from "../guard-ignore-tag-reason";

const ROOTS = [{ absPath: "/repo" }];

function weakLines(source: string): number[] {
  return findWeakIgnoreReasons(source).map((site) => site.line);
}

describe("ignore-tag-reason guard", () => {
  test.each([
    "// kumiko-lint-ignore raw-sql",
    "// kumiko-lint-ignore raw-sql legacy",
    "// kumiko-lint-ignore raw-sql todo: later",
    "// kumiko-lint-ignore cross-feature-import invite-flow",
    "// kumiko-lint-ignore cross-feature-import two words",
    "/* kumiko-lint-ignore raw-sql short */",
    "const a = 1; // kumiko-lint-ignore raw-sql,comment-lang tmp",
  ])("flags a missing, generic or too short reason: %s", (comment) => {
    expect(weakLines(`${comment}\nexport const value = 1;\n`)).toEqual([1]);
  });

  test.each([
    "// kumiko-lint-ignore raw-sql migration reads the catalog table directly",
    "/* kumiko-lint-ignore raw-sql the catalog has no entity */",
    "const a = 1; // kumiko-lint-ignore raw-sql,comment-lang fixture text for the parser",
    "// kumiko-lint-ignore comment-issue-ref-only <reason>",
    "// Opt-out: add kumiko-lint-ignore anywhere in the sentence",
    "// kumiko-lint-ignore",
  ])("leaves a real reason, a documentation placeholder and prose alone: %s", (comment) => {
    expect(weakLines(`${comment}\nexport const value = 1;\n`)).toEqual([]);
  });

  test("ignores tags inside string literals and reads the line inside a block comment", () => {
    const source = [
      'const doc = "// kumiko-lint-ignore raw-sql legacy";',
      "/**",
      " * Escape hatch below.",
      " * kumiko-lint-ignore raw-sql todo",
      " */",
    ].join("\n");
    expect(weakLines(source)).toEqual([4]);
  });

  test("counts hits per file relative to the repo root and skips declaration files", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const files = [
      project.createSourceFile(
        "/repo/packages/a/src/one.ts",
        "// kumiko-lint-ignore raw-sql legacy\nconst a = 1; // kumiko-lint-ignore raw-sql tmp\n",
      ),
      project.createSourceFile(
        "/repo/packages/a/src/clean.ts",
        "// kumiko-lint-ignore raw-sql explains the exception in full\n",
      ),
      project.createSourceFile(
        "/repo/packages/a/src/types.d.ts",
        "// kumiko-lint-ignore raw-sql x\n",
      ),
    ];
    expect(weakIgnoreReasonCounts(files, ROOTS)).toEqual({
      counts: { "packages/a/src/one.ts": 2 },
      firstLine: { "packages/a/src/one.ts": 1 },
    });
  });
});
