import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import {
  findIssueRefOnlyComments,
  isIssueRefOnlyComment,
  issueRefOnlyCounts,
} from "../guard-comment-issue-ref-only";

const ROOTS = [{ absPath: "/repo" }];

function hitLines(source: string): number[] {
  return findIssueRefOnlyComments(source).map((site) => site.line);
}

describe("comment-issue-ref-only guard", () => {
  test.each([
    "// #1234",
    "// See fw#3646.",
    "// Fix for ent#12",
    "// Phase 3",
    "// round5",
    "// Phase 3.",
    "/** S2.H1 */",
    "// Follow-up: kumiko-framework#88, Wave 4",
  ])("flags a comment that only references a tracker or plan: %s", (comment) => {
    expect(isIssueRefOnlyComment(comment)).toBe(true);
  });

  test.each([
    "// Retry once because the upstream socket closes early (fw#12).",
    "// oven-sh/bun#5 crashes on empty request bodies",
    "// Phase 2 rows still lack the tenant column, so fall back to the default.",
    "// Pinned to v1.2.3 until the parser handles BOM input",
    "// See https://github.com/oven-sh/bun/issues/5",
    "// &#39; is the escaped apostrophe",
    "// A plain comment without any reference",
    "// see extractors/round2.ts",
    "// see round2.ts",
    "// load phase1.sql",
    "// see dir/S2.H1",
    "// @timeout-exception: #3118 paces repeated dispatch attempts, nothing to poll for",
  ])("leaves a comment with an explanation or without a reference alone: %s", (comment) => {
    expect(isIssueRefOnlyComment(comment)).toBe(false);
  });

  test("respects the ignore tag", () => {
    expect(
      isIssueRefOnlyComment("// #12 kumiko-lint-ignore comment-issue-ref-only upstream mirror"),
    ).toBe(false);
  });

  test("reads consecutive own-line comments as one paragraph", () => {
    const source = [
      "// Keeps the order stable for event replays.",
      "// See #12.",
      "const a = 1;",
      "",
      "// See #13.",
      "",
      "// Phase 4",
      "const b = 2; // #14",
    ].join("\n");
    expect(hitLines(source)).toEqual([5, 7, 8]);
  });

  test("flags a multi-line JSDoc that only names a plan step", () => {
    const source = ["/**", " * Part of Phase 2.", " */", "export const value = 1;"].join("\n");
    expect(hitLines(source)).toEqual([1]);
  });

  test("ignores references inside strings, templates and regex literals", () => {
    const source = [
      'const label = "// #12";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
      "const text = `/* fw#3 */ ${label}`;",
      "const pattern = /\\/\\/ #4/;",
    ].join("\n");
    expect(hitLines(source)).toEqual([]);
  });

  test("counts hits per file relative to the repo root and skips declaration files", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const files = [
      project.createSourceFile("/repo/packages/a/src/one.ts", "// #1\nconst a = 1; // #2\n"),
      project.createSourceFile("/repo/packages/a/src/clean.ts", "// Explains why.\n"),
      project.createSourceFile("/repo/packages/a/src/types.d.ts", "// #3\n"),
    ];
    expect(issueRefOnlyCounts(files, ROOTS)).toEqual({
      counts: { "packages/a/src/one.ts": 2 },
      firstLine: { "packages/a/src/one.ts": 1 },
    });
  });
});
