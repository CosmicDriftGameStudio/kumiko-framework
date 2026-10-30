import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import type { RepoRoot } from "../_lib/roots";
import { findSqlSessionSettings, guard } from "../guard-rls-session-settings";

const frameworkRoot: RepoRoot = {
  name: "kumiko-framework",
  absPath: "/fx/fw",
  kind: "framework",
  manifest: { kind: "framework", sourceRoots: ["packages/*/src"], testGlobs: [] },
  manifestSource: "derived",
};
const roots = [frameworkRoot];

const RLS_SCOPE = "/fx/fw/packages/framework/src/db/queries/rls-scope.ts";
const SOURCE = "/fx/fw/packages/x/src/a.ts";
const TEST = "/fx/fw/packages/x/src/__tests__/a.integration.test.ts";

function run(path: string, sql: string, quote = "`") {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  const sf: SourceFile = project.createSourceFile(path, `export const q = ${quote}${sql}${quote};`);
  return guard.run([sf], roots).violations;
}

// Assembled at runtime so this file's own literals never look like a session-level setting.
const sql = (...parts: string[]) => parts.join(" ");
const OFF = ["fal", "se"].join("");
const SC = ["set", "config"].join("_");
const call = (...args: string[]) => `SELECT ${SC}(${args.join(", ")})`;

describe("RLS-Session-Settings Guard: session-level settings", () => {
  test.each([
    sql("SET", "kumiko.tenant_id", "=", "'t'"),
    sql("set", "session", "kumiko.scope", "=", "'system'"),
    sql("SET", "SESSION", "kumiko.scope", "TO", "'system'"),
  ])("flags %s in a test file", (statement) => {
    const violations = run(TEST, statement);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("SET / SET SESSION");
  });

  test.each([
    call("'statement_timeout'", "'0'", OFF),
    call("$1", "$2", OFF.toUpperCase()),
    call("'kumiko.scope'", "lower('X')", OFF),
    call("'statement_timeout'", "'0'", "$3"),
    call("'statement_timeout'", "'0'", "isLocal"),
    call("'statement_timeout'", "'0'"),
  ])("flags a set_config whose is_local is not literal true: %s", (statement) => {
    const violations = run(TEST, statement);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("literal true as is_local");
  });

  test.each([
    sql("SET", '"kumiko.tenant_id"', "=", "'t'"),
    sql("SET", "SESSION", '"kumiko.scope"', "TO", "'system'"),
  ])("flags a quoted setting name: %s", (statement) => {
    const violations = run(TEST, statement);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("SET / SET SESSION");
  });

  test("flags a quoted SET LOCAL in production code", () => {
    const violations = run(SOURCE, sql("SET", "LOCAL", '"kumiko.tenant_id"', "=", "'t'"));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("only rls-scope.ts");
  });

  test("a backtick argument holds commas and parentheses without shifting is_local", () => {
    expect(run(TEST, call("'x'", "`a,b)`", OFF), '"')).toHaveLength(1);
    expect(run(TEST, call("'x'", "`a,b)`", "true"), '"')).toHaveLength(0);
  });

  test("flags a plain string and a template with substitutions", () => {
    expect(run(TEST, sql("SET", "kumiko.x", "=", "1"), '"')).toHaveLength(1);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: "${v}" is the substitution the guard must flag in the generated SQL template
    expect(run(TEST, sql("SET", "kumiko.x", "=", "${v}"))).toHaveLength(1);
  });
});

describe("RLS-Session-Settings Guard: scope writer", () => {
  test("flags a kumiko.* write outside rls-scope.ts in production code", () => {
    for (const statement of [
      sql("SET", "LOCAL", "kumiko.tenant_id", "=", "'t'"),
      call("'kumiko.tenant_id'", "$1", "true"),
    ]) {
      const violations = run(SOURCE, statement);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("only rls-scope.ts");
    }
  });

  test("allows rls-scope.ts to set_config with true and parameters", () => {
    expect(run(RLS_SCOPE, `${call("$1", "$2", "true")}, ${SC}($3, $4, true)`)).toHaveLength(0);
  });

  test("flags a set_config in rls-scope.ts without literal true", () => {
    const violations = run(RLS_SCOPE, call("$1", "$2", "$3"));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("literal true as is_local");
    expect(run(RLS_SCOPE, call("$1", "$2", OFF)).length).toBeGreaterThan(0);
  });
});

describe("RLS-Session-Settings Guard: allowed forms", () => {
  test("a test file may write transaction-local kumiko settings", () => {
    expect(run(TEST, sql("SET", "LOCAL", "kumiko.tenant_id", "=", "'t'"))).toHaveLength(0);
    expect(run(TEST, call("'kumiko.scope'", "$1", "true"))).toHaveLength(0);
  });

  test("a dynamic setting name is flagged in production code, not in tests or rls-scope.ts", () => {
    const statement = call("$1", "$2", "true");
    const violations = run(SOURCE, statement);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("dynamic setting name");
    expect(run(TEST, statement)).toHaveLength(0);
    expect(run(RLS_SCOPE, statement)).toHaveLength(0);
  });

  test("set_config on other settings with true stays allowed", () => {
    expect(run(SOURCE, call("'statement_timeout'", "'0'", "true"))).toHaveLength(0);
  });

  test("unrelated strings and prose mentioning the setting are ignored", () => {
    expect(run(SOURCE, "SELECT 1")).toHaveLength(0);
    expect(run(SOURCE, "Set kumiko.deploy.infraRef to an infra tag")).toHaveLength(0);
    expect(run(SOURCE, "SELECT current_setting('kumiko.scope', true)")).toHaveLength(0);
  });
});

describe("RLS-Session-Settings Guard: .sql files", () => {
  const SET_KEYWORD = ["SET", "SESSION"].join(" ");

  test("flags a session-level SET and a non-local setter with the statement line", () => {
    const sql = `CREATE TABLE t (id int);\n\n${SET_KEYWORD} kumiko.tenant_id = 'x';\nSELECT ${SC}('kumiko.scope', 'system', ${OFF});`;
    const found = findSqlSessionSettings(sql, "migrations/0001.sql");
    expect(found.map((f) => f.line)).toEqual([3, 4, 4]);
    expect(found[0]?.message).toContain("[rls-session-setting]");
  });

  test("flags any kumiko.* write in a migration, even a local one", () => {
    const found = findSqlSessionSettings(
      "SET LOCAL kumiko.scope = 'system';",
      "migrations/0002.sql",
    );
    expect(found).toHaveLength(1);
  });

  test("ignores comments and policy reads of the setting", () => {
    const sql = `-- ${SET_KEYWORD} kumiko.tenant_id = 'x' is wrong\nCREATE POLICY p ON t USING (tenant_id = NULLIF(current_setting('kumiko.tenant_id', true), '')::uuid);`;
    expect(findSqlSessionSettings(sql, "migrations/0003.sql")).toHaveLength(0);
  });
});
