import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import {
  type Category,
  categorize,
  collect,
  getFileDefaultReason,
  legitCountsByPackage,
  loadBaseline,
  reportBaseline,
} from "../check-as-casts";

type TestSite = Parameters<typeof reportBaseline>[0][number];

function suspectSite(file: string, line: number, target = "string"): TestSite {
  return { file, line, category: "suspect-narrow", source: "x", target, full: `x as ${target}` };
}

function boundarySite(file: string, line: number, boundaryReason?: string): TestSite {
  const category: Category = "legit-boundary";
  return {
    file,
    line,
    category,
    source: "x",
    target: "Foo",
    full: "x as Foo",
    ...(boundaryReason === undefined ? {} : { boundaryReason }),
  };
}

function castIn(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("packages/framework/src/x/cast.ts", code);
  return sf.getFirstDescendantByKindOrThrow(SyntaxKind.AsExpression);
}

describe("As-Casts Audit", () => {
  test("categorizes a narrowing cast on a bare identifier as suspect-narrow", () => {
    const cast = castIn("declare const x: unknown;\nexport const y = x as string;");
    expect(categorize(cast)).toBe("suspect-narrow");
  });

  test("categorizes `x as const` as legit-const, not a suspect cast", () => {
    const cast = castIn('export const y = "a" as const;');
    expect(categorize(cast)).toBe("legit-const");
  });

  test("categorizes a `@cast-boundary` marked cast as legit-boundary", () => {
    const cast = castIn(
      "declare const result: { data: unknown };\n// @cast-boundary db-row\nexport const y = result.data as Record<string, unknown>;",
    );
    expect(categorize(cast)).toBe("legit-boundary");
  });
});

describe("cast baseline file", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cast-baseline-"));
    file = path.join(dir, ".kumiko-cast-baseline.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("a merge-conflict baseline yields a violation naming the file, not a throw", () => {
    writeFileSync(file, '<<<<<<< HEAD\n{"format":2}\n=======\n{"format":2}\n>>>>>>> main\n');
    const violations = reportBaseline([], file);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(file);
    expect(violations[0]?.message).toContain(`Cannot read cast baseline ${file}`);
  });

  test("a baseline with a wrongly shaped perFile is invalid", () => {
    writeFileSync(
      file,
      JSON.stringify({ format: 2, generated: "x", totalSuspect: 1, perFile: { a: { b: "1" } } }),
    );
    expect(loadBaseline(file).kind).toBe("invalid");
    expect(reportBaseline([], file)).toHaveLength(1);
  });

  test("a valid baseline loads and reports no violations", () => {
    writeFileSync(
      file,
      JSON.stringify({ format: 2, generated: "x", totalSuspect: 0, perFile: {} }),
    );
    expect(loadBaseline(file).kind).toBe("ok");
    expect(reportBaseline([], file)).toEqual([]);
  });

  test("a missing baseline is still only a warning", () => {
    expect(reportBaseline([suspectSite("a.ts", 1)], file)).toEqual([]);
  });

  function writeValidBaseline(perFile: Record<string, Record<string, number>>): void {
    writeFileSync(file, JSON.stringify({ format: 2, generated: "x", totalSuspect: 0, perFile }));
  }

  test("more suspect casts than the baseline is a violation at the first new cast", () => {
    writeValidBaseline({ "src/a.ts": { string: 1 } });
    const violations = reportBaseline(
      [suspectSite("src/a.ts", 5), suspectSite("src/a.ts", 9)],
      file,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("src/a.ts");
    expect(violations[0]?.line).toBe(9);
    expect(violations[0]?.message).toContain("as string");
    expect(violations[0]?.message).toContain("baseline=1, current=2");
    expect(violations[0]?.message).toContain("@cast-boundary");
    expect(violations[0]?.message).toContain("--write-baseline");
  });

  test("fewer suspect casts than the baseline is no violation", () => {
    writeValidBaseline({ "src/a.ts": { string: 3 } });
    expect(reportBaseline([suspectSite("src/a.ts", 5)], file)).toEqual([]);
  });

  test("re-indenting a multi-line cast target does not read as a regression", () => {
    const sourceWith = (indent: string) =>
      `declare const x: unknown;\nexport const y = x as {\n${indent}a: string;\n${indent}b: number;\n};`;
    const siteOf = (code: string) => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sf = project.createSourceFile("packages/framework/src/x/cast.ts", code);
      const [site] = collect(sf);
      if (site === undefined) throw new Error("expected one cast site");
      return { ...site, file: "src/a.ts" };
    };
    const first = siteOf(sourceWith("  "));
    const reindented = siteOf(sourceWith("      "));
    expect(reindented.target).toBe(first.target);
    writeValidBaseline({ "src/a.ts": { [first.target]: 1 } });
    expect(reportBaseline([reindented], file)).toEqual([]);
  });

  test("an unknown boundary reason in a repo-local file is a violation when a baseline exists", () => {
    writeValidBaseline({});
    const violations = reportBaseline([boundarySite("src/a.ts", 4, "made-up")], file);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.message).toContain("made-up");
  });

  test("a missing boundary reason in a repo-local file is a violation when a baseline exists", () => {
    writeValidBaseline({});
    expect(reportBaseline([boundarySite("src/a.ts", 4)], file)).toHaveLength(1);
  });

  test("a known boundary reason is no violation", () => {
    writeValidBaseline({});
    expect(reportBaseline([boundarySite("src/a.ts", 4, "db-row")], file)).toEqual([]);
  });

  test("an unknown boundary reason under ../sibling is never a violation", () => {
    writeValidBaseline({});
    expect(reportBaseline([boundarySite("../sibling/src/a.ts", 4, "made-up")], file)).toEqual([]);
  });

  test("suspect casts under ../sibling never regress the baseline", () => {
    writeValidBaseline({});
    expect(reportBaseline([suspectSite("../sibling/src/a.ts", 4)], file)).toEqual([]);
  });

  test("an unknown boundary reason without a baseline is only a warning", () => {
    expect(reportBaseline([boundarySite("src/a.ts", 4, "made-up")], file)).toEqual([]);
  });

  test("a baseline with an outdated format is a violation, not a silent pass", () => {
    writeFileSync(file, JSON.stringify({ format: 1, perFile: {} }));
    expect(loadBaseline(file).kind).toBe("format-drift");
    const violations = reportBaseline([], file);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(file);
    expect(violations[0]?.message).toContain("format drift");
  });
});

describe("legit cast ratchet", () => {
  test("counts bridge and boundary casts per package and category, ignoring siblings", () => {
    const bridge = (file: string): TestSite => ({
      ...suspectSite(file, 1),
      category: "legit-bridge",
    });
    const counts = legitCountsByPackage([
      bridge("packages/renderer/src/a.ts"),
      bridge("packages/renderer/src/deep/b.ts"),
      boundarySite("packages/renderer/src/c.ts", 3, "error-details"),
      boundarySite("packages/types/src/d.ts", 4, "error-details"),
      bridge("../other/packages/x/src/e.ts"),
      suspectSite("packages/renderer/src/f.ts", 5),
    ]);
    expect(counts).toEqual({
      "packages/renderer:legit-bridge": 2,
      "packages/renderer:legit-boundary": 1,
      "packages/types:legit-boundary": 1,
    });
  });
});

describe("file default reasons", () => {
  test("feature-ast extractors and parsers default to schema-walk", () => {
    expect(getFileDefaultReason("/repo/packages/feature-ast/src/extractors/hooks.ts")).toBe(
      "schema-walk",
    );
    expect(getFileDefaultReason("/repo/packages/feature-ast/src/parse.ts")).toBe("schema-walk");
  });

  test("feature-ast codemods, scripts and the pattern library do not", () => {
    for (const file of [
      "/repo/packages/feature-ast/src/codemod/pipeline-codemod.ts",
      "/repo/packages/feature-ast/src/scripts/codemod/db-factory.ts",
      "/repo/packages/feature-ast/src/pattern-library/library.ts",
      "/repo/packages/framework/src/engine/feature-ast/parse.ts",
    ]) {
      expect(getFileDefaultReason(file)).toBeNull();
    }
  });
});
