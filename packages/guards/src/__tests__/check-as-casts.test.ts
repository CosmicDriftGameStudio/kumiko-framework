import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import { categorize, guard, loadBaseline, reportBaseline } from "../check-as-casts";

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

  test("guard.run() never returns blocking violations (coding-standards.md: Warnung, kein Fail)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "packages/framework/src/x/cast.ts",
      "declare const x: unknown;\nexport const y = x as string;",
    );
    expect(guard.run([sf]).violations).toEqual([]);
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
    expect(reportBaseline([], file)).toEqual([]);
  });
});
