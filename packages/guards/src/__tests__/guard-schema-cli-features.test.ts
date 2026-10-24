import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import type { RepoRoot } from "../_lib/roots";
import { check, findSchemaCliFeatureProblems } from "../guard-schema-cli-features";

function problemsOf(source: string) {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  return findSchemaCliFeatureProblems(project.createSourceFile("/repo/bin/kumiko.ts", source));
}

const SCHEMA_CLI_IMPORT = `import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";\n`;

describe("findSchemaCliFeatureProblems", () => {
  test("accepts features: FEATURES imported from kumiko/schema", () => {
    expect(
      problemsOf(`${SCHEMA_CLI_IMPORT}import { FEATURES } from "../kumiko/schema";
await runSchemaCli(rest, cwd, out, { features: FEATURES, kmsSlots });`),
    ).toEqual([]);
  });

  test("accepts the shorthand and an aliased import of FEATURES", () => {
    expect(
      problemsOf(`${SCHEMA_CLI_IMPORT}import { FEATURES as features } from "../kumiko/schema";
await runSchemaCli(rest, cwd, out, { features, kmsSlots });`),
    ).toEqual([]);
  });

  test("flags allAppFeatures(...) and names the fix", () => {
    const problems = problemsOf(`${SCHEMA_CLI_IMPORT}
await runSchemaCli(rest, cwd, out, { features: allAppFeatures(appConfig), kmsSlots });`);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("allAppFeatures(appConfig)");
    expect(problems[0]?.message).toContain('import { FEATURES } from "../kumiko/schema"');
  });

  test("flags an array literal", () => {
    expect(
      problemsOf(`${SCHEMA_CLI_IMPORT}
await runSchemaCli(rest, cwd, out, { features: [a, b], kmsSlots });`),
    ).toHaveLength(1);
  });

  test("flags a local features constant and a FEATURES from another module", () => {
    expect(
      problemsOf(`${SCHEMA_CLI_IMPORT}const features = compose();
await runSchemaCli(rest, cwd, out, { features, kmsSlots });`),
    ).toHaveLength(1);
    expect(
      problemsOf(`${SCHEMA_CLI_IMPORT}import { FEATURES } from "./other";
await runSchemaCli(rest, cwd, out, { features: FEATURES });`),
    ).toHaveLength(1);
  });

  test("flags another export of kumiko/schema", () => {
    expect(
      problemsOf(`${SCHEMA_CLI_IMPORT}import { ENTITY_METAS } from "../kumiko/schema";
await runSchemaCli(rest, cwd, out, { features: ENTITY_METAS });`),
    ).toHaveLength(1);
  });

  test("flags missing options and a missing features property", () => {
    expect(problemsOf(`${SCHEMA_CLI_IMPORT}await runSchemaCli(rest, cwd, out);`)).toHaveLength(1);
    expect(
      problemsOf(`${SCHEMA_CLI_IMPORT}await runSchemaCli(rest, cwd, out, { kmsSlots });`),
    ).toHaveLength(1);
  });

  test("ignores files without a runSchemaCli call", () => {
    expect(problemsOf(`const features = allAppFeatures(appConfig);`)).toEqual([]);
  });
});

describe("Schema CLI Features check", () => {
  const BAD_CLI = `import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";
await runSchemaCli(rest, cwd, out, { features: allAppFeatures(appConfig) });
`;

  function runIn(kind: RepoRoot["kind"], files: Record<string, string>, excludes?: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "schema-cli-features-"));
    try {
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(join(dir, rel, ".."), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
      const root: RepoRoot = {
        name: "fixture-app",
        absPath: dir,
        kind,
        manifest: { kind, sourceRoots: ["bin"], testGlobs: ["bin/**/*.test.ts"], excludes },
        manifestSource: "derived",
      };
      return check.run([root]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("reports a violation in an app that has kumiko/schema.ts", async () => {
    const outcome = await runIn("app", {
      "kumiko/schema.ts": "export const FEATURES = [];\n",
      "bin/kumiko.ts": BAD_CLI,
    });
    expect(outcome.notApplicable).toBe(false);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.line).toBe(2);
  });

  test("a manifest exclude cannot hide bin/kumiko.ts", async () => {
    const outcome = await runIn(
      "app",
      { "kumiko/schema.ts": "export const FEATURES = [];\n", "bin/kumiko.ts": BAD_CLI },
      ["bin/kumiko.ts"],
    );
    expect(outcome.violations).toHaveLength(1);
  });

  test("is not applicable without kumiko/schema.ts", async () => {
    const outcome = await runIn("app", { "bin/kumiko.ts": BAD_CLI });
    expect(outcome.notApplicable).toBe(true);
    expect(outcome.violations).toEqual([]);
  });

  test("skips the framework repo", async () => {
    const outcome = await runIn("framework", {
      "kumiko/schema.ts": "export const FEATURES = [];\n",
      "bin/kumiko.ts": BAD_CLI,
    });
    expect(outcome.notApplicable).toBe(true);
  });
});
