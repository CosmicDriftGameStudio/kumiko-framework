import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import type { RepoRoot } from "../_lib/roots";
import { guard } from "../guard-internal-subpath-imports";

const frameworkRoot: RepoRoot = {
  name: "kumiko-framework",
  absPath: "/fx/fw",
  kind: "framework",
  manifest: { kind: "framework", sourceRoots: ["packages/*/src"], testGlobs: [] },
  manifestSource: "derived",
};
const appRoot: RepoRoot = {
  name: "some-app",
  absPath: "/fx/app",
  kind: "app",
  manifest: { kind: "app", sourceRoots: ["src"], testGlobs: [] },
  manifestSource: "derived",
};
const roots = [frameworkRoot, appRoot];

function run(map: Record<string, string>) {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  const sfs: SourceFile[] = Object.entries(map).map(([p, src]) => project.createSourceFile(p, src));
  return guard.run(sfs, roots).violations;
}

const INTERNAL = "@cosmicdrift/kumiko-framework/internal/row-level-security";
const HELPERS = "@cosmicdrift/kumiko-testing/helpers";

describe("Internal-Subpath-Imports Guard: rule 1 (internal subpath)", () => {
  test("flags import, re-export and dynamic import in a consumer repo", () => {
    const violations = run({
      "/fx/app/src/a.ts": `import { x } from "${INTERNAL}";\nvoid x;`,
      "/fx/app/src/b.ts": `export { y } from "${INTERNAL}";`,
      "/fx/app/src/c.ts": `export const z = import("${INTERNAL}");`,
    });
    expect(violations.map((v) => v.file).sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(violations.every((v) => v.message.includes("[internal-import]"))).toBe(true);
  });

  test("allows the framework repo itself", () => {
    const violations = run({
      "/fx/fw/packages/server-runtime/src/a.ts": `import { x } from "${INTERNAL}";\nvoid x;`,
    });
    expect(violations).toHaveLength(0);
  });

  test("allows public subpaths in a consumer repo", () => {
    const violations = run({
      "/fx/app/src/a.ts": `import { x } from "@cosmicdrift/kumiko-framework/db";\nvoid x;`,
    });
    expect(violations).toHaveLength(0);
  });
});

describe("Internal-Subpath-Imports Guard: rule 2 (test-only scope helpers)", () => {
  const source = `import { runInSystemRowLevelSecurityScope } from "${HELPERS}";\nrunInSystemRowLevelSecurityScope("seed", () => 1);`;

  test("flags a production file in any repo kind", () => {
    expect(run({ "/fx/app/src/a.ts": source })).toHaveLength(1);
    expect(run({ "/fx/fw/packages/x/src/a.ts": source })).toHaveLength(1);
  });

  test("allows __tests__, .test.ts and .integration.test.ts files", () => {
    expect(run({ "/fx/app/src/__tests__/a.ts": source })).toHaveLength(0);
    expect(run({ "/fx/app/src/a.test.ts": source })).toHaveLength(0);
    expect(run({ "/fx/app/src/a.integration.test.ts": source })).toHaveLength(0);
  });

  test("other helpers from the same subpath stay allowed", () => {
    const violations = run({
      "/fx/app/src/a.ts": `import { waitFor } from "${HELPERS}";\nvoid waitFor;`,
    });
    expect(violations).toHaveLength(0);
  });
});

describe("Internal-Subpath-Imports Guard: rule 3 (system scope reason)", () => {
  const importLine = `import { runInSystemRowLevelSecurityScope, systemScopedRunner } from "@cosmicdrift/kumiko-framework/db";\n`;

  test("allows string-literal reasons", () => {
    const violations = run({
      "/fx/fw/packages/x/src/a.ts": `${importLine}runInSystemRowLevelSecurityScope("sweeps all tenants", () => 1);\nsystemScopedRunner({}, "sweeps all tenants");`,
    });
    expect(violations).toHaveLength(0);
  });

  test.each([
    "runInSystemRowLevelSecurityScope(() => 1);",
    'runInSystemRowLevelSecurityScope("  ", () => 1);',
    'const r = "x"; runInSystemRowLevelSecurityScope(r, () => 1);',
    "runInSystemRowLevelSecurityScope(`why $" + "{1}`, () => 1);",
    "systemScopedRunner({});",
    'systemScopedRunner({}, "");',
  ])("flags %s", (call) => {
    const violations = run({ "/fx/fw/packages/x/src/a.ts": `${importLine}${call}` });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("[system-scope-reason]");
  });

  test("an aliased import does not evade the check", () => {
    const violations = run({
      "/fx/fw/packages/x/src/a.ts": `import { runInSystemRowLevelSecurityScope as enter } from "@cosmicdrift/kumiko-framework/db";\nenter(() => 1);`,
    });
    expect(violations).toHaveLength(1);
  });

  test("SYSTEM_ROW_LEVEL_SECURITY_SCOPE is limited to the allowlist", () => {
    const source = `import { SYSTEM_ROW_LEVEL_SECURITY_SCOPE } from "./row-level-security-scope.ts";\nvoid SYSTEM_ROW_LEVEL_SECURITY_SCOPE;`;
    expect(
      run({ "/fx/fw/packages/framework/src/pipeline/rogue.ts": source }).length,
    ).toBeGreaterThan(0);
    expect(run({ "/fx/fw/packages/framework/src/db/migrate-runner.ts": source })).toHaveLength(0);
    expect(
      run({ "/fx/fw/packages/framework/src/pipeline/dispatch-scope.ts": source }),
    ).toHaveLength(0);
  });
});
