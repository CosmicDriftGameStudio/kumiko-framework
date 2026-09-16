import { describe, expect, test } from "bun:test";
import { Project, SyntaxKind } from "ts-morph";
import { categorize, guard } from "../check-as-casts";

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
