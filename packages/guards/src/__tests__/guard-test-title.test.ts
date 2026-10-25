import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { findBadTestTitles, hasIssueReference, testTitleCounts } from "../guard-test-title";

const ROOTS = [{ absPath: "/repo" }];

function hits(source: string): Array<{ line: number; reason: string }> {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    "/repo/a.test.ts",
    source,
  );
  return findBadTestTitles(sf).map(({ line, reason }) => ({ line, reason }));
}

describe("test-title guard", () => {
  test("flags a German title", () => {
    expect(hits('test("lehnt ab, wenn der Wert nicht gesetzt ist", () => {});')).toEqual([
      { line: 1, reason: "German" },
    ]);
  });

  test("flags an issue reference in a title", () => {
    expect(hits('it("rejects the wrong ctx shape (#3196)", () => {});')).toEqual([
      { line: 1, reason: "issue reference" },
    ]);
    expect(hits('it("kumiko-framework#1525: rejects it", () => {});')).toHaveLength(1);
  });

  test("covers describe.each, .skip, .only, .todo and .if chains and Playwright test.describe", () => {
    const source = [
      'describe.each([1])("Wert nicht gesetzt oder leer", () => {});',
      'describe.skip("blocks #123", () => {});',
      'test.only("works (#4000)", () => {});',
      'test.todo("fix for fw#12");',
      'test.if(true)("auch dann nicht erlaubt, wenn aktiv", () => {});',
      'test.describe("regression for #197", () => {});',
      "test.each([1])(`mit Template ohne Umlaut und nicht \u0024{1}`, () => {});",
    ].join("\n");
    expect(hits(source).map((h) => h.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("leaves English titles, fixture names, hex colours and non-title calls alone", () => {
    const source = [
      'test("rejects an empty list", () => {});',
      'test("renders Müller GmbH in Zürich", () => {});',
      'test("accepts #rrggbb and #fff colours", () => {});',
      'test("keeps the &#39; entity", () => {});',
      'expect(translate("nicht gesetzt oder leer")).toBe("x");',
      "test(title, () => {});",
    ].join("\n");
    expect(hits(source)).toEqual([]);
  });

  test("honours the ignore tag on the line above and on the same line", () => {
    const source = [
      "// kumiko-lint-ignore test-title german fixture title under test",
      'test("wenn nicht gesetzt oder leer", () => {});',
      'test("wenn nicht gesetzt oder leer", () => {}); // kumiko-lint-ignore test-title german fixture title',
      "",
      'test("wenn nicht gesetzt oder leer", () => {});',
    ].join("\n");
    expect(hits(source).map((h) => h.line)).toEqual([5]);
  });

  test("hasIssueReference needs digits after the hash", () => {
    expect(hasIssueReference("see #12")).toBe(true);
    expect(hasIssueReference("colour #rrggbb")).toBe(false);
    expect(hasIssueReference("colour #fff000")).toBe(false);
  });

  test("counts hits per file relative to the repo root and skips declaration files", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const files = [
      project.createSourceFile(
        "/repo/packages/a/src/one.test.ts",
        'test("a (#1234)", () => {});\ntest("wenn nicht gesetzt", () => {});\n',
      ),
      project.createSourceFile("/repo/packages/a/src/clean.test.ts", 'test("ok", () => {});\n'),
      project.createSourceFile("/repo/packages/a/src/types.d.ts", 'test("a (#1234)", () => {});\n'),
    ];
    expect(testTitleCounts(files, ROOTS)).toEqual({
      counts: { "packages/a/src/one.test.ts": 2 },
      firstLine: { "packages/a/src/one.test.ts": 1 },
    });
  });
});
