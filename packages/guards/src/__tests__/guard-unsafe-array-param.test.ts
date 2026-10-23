import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import type { RepoRoot } from "../_lib/roots";
import { check, findUnsafeArrayParams } from "../guard-unsafe-array-param";

function findingsOf(source: string) {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  return findUnsafeArrayParams(project.createSourceFile("/repo/src/query.ts", source));
}

describe("findUnsafeArrayParams", () => {
  test("flags an array literal inside the parameter list", () => {
    const findings = findingsOf(
      `await db.unsafe("SELECT 1 WHERE id = ANY($1) AND tenant = $2", [["a", "b"], tenantId]);`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("toPostgresArrayLiteral");
  });

  test("flags a copied array literal [...ids] as parameter", () => {
    expect(findingsOf(`await tx.unsafe(sql, [[...ids]]);`)).toHaveLength(1);
  });

  test("flags a spread in the parameter list", () => {
    const findings = findingsOf(`await tx.unsafe(sql, [tenantId, ...ids]);`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("spread");
  });

  test("stays silent for toPostgresArrayLiteral(...) and scalar parameters", () => {
    expect(
      findingsOf(
        `await db.unsafe("... ANY($1::text[]) AND t = $2", [toPostgresArrayLiteral(ids), tenantId]);`,
      ),
    ).toEqual([]);
  });

  test("stays silent for calls without a parameter list and for other methods", () => {
    expect(findingsOf(`await db.unsafe("SELECT 1"); other.query(sql, [[1, 2]]);`)).toEqual([]);
  });
});

describe("Unsafe Array Param check", () => {
  function runIn(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "unsafe-array-param-"));
    try {
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(join(dir, rel, ".."), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
      const root: RepoRoot = {
        name: "fixture-app",
        absPath: dir,
        kind: "app",
        manifest: { kind: "app", sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] },
        manifestSource: "derived",
      };
      return check.run([root]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("reports a warning, never a violation", async () => {
    const outcome = await runIn({
      "src/query.ts": `await db.unsafe("... ANY($1)", [["a", "b"]]);\n`,
    });
    expect(outcome.violations).toEqual([]);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings?.[0]?.line).toBe(1);
    expect(outcome.matchedFiles).toBe(1);
  });

  test("clean sources produce no warning", async () => {
    const outcome = await runIn({
      "src/query.ts": `await db.unsafe("... ANY($1::text[])", [toPostgresArrayLiteral(ids)]);\n`,
    });
    expect(outcome.warnings).toBeUndefined();
  });
});
