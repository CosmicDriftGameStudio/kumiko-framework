import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderBootRules } from "../_lib/agent-docs-boot-rules";
import { createAgentDocsProject } from "../_lib/agent-docs-shared";

const FRAMEWORK_RULES_PATH = "packages/framework/src/engine/boot-validator/pii-rules.ts";
const FEATURE_RULES_PATH = "packages/bundled-features/src/user-data-rights/boot-rules.ts";

function rulesFile(table: string, entries: readonly string[]): string {
  return `export const ${table} = {\n${entries.join("\n")}\n} as const satisfies BootRuleTable;\n`;
}

function rule(key: string, id: string, fix = '"Do it."'): string {
  return `  ${key}: { id: "${id}", summary: "Must hold.", fix: ${fix} },`;
}

function render(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "agent-docs-boot-rules-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    return renderBootRules(root, createAgentDocsProject(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("renderBootRules", () => {
  test("groups rules from both globs by area, sorted, with anchor and source", () => {
    const output = render({
      [FRAMEWORK_RULES_PATH]: rulesFile("PII_RULES", [
        rule("b", "pii/zeta-rule"),
        rule("a", "pii/alpha-rule"),
      ]),
      [FEATURE_RULES_PATH]: rulesFile("UDR_RULES", [rule("c", "user-data-rights/missing-hook")]),
    });
    expect(output).toContain("# Boot rules");
    expect(output.indexOf("## pii")).toBeLessThan(output.indexOf("## user-data-rights"));
    expect(output.indexOf("pii/alpha-rule")).toBeLessThan(output.indexOf("pii/zeta-rule"));
    expect(output).toContain(
      `| <a id="user-data-rights-missing-hook"></a>\`user-data-rights/missing-hook\` | Must hold. | Do it. | \`${FEATURE_RULES_PATH}\` |`,
    );
  });

  test("a duplicate id across files throws", () => {
    expect(() =>
      render({
        [FRAMEWORK_RULES_PATH]: rulesFile("A", [rule("a", "pii/same-rule")]),
        [FEATURE_RULES_PATH]: rulesFile("B", [rule("b", "pii/same-rule")]),
      }),
    ).toThrow(/Duplicate boot rule id "pii\/same-rule"/);
  });

  test("two ids with the same anchor throw", () => {
    expect(() =>
      render({
        [FRAMEWORK_RULES_PATH]: rulesFile("A", [rule("a", "a/b-c"), rule("b", "a-b/c")]),
      }),
    ).toThrow(/share the anchor "a-b-c"/);
  });

  test("a fix that is not a plain string literal throws and names file and property", () => {
    expect(() =>
      render({
        [FRAMEWORK_RULES_PATH]: rulesFile("A", [rule("a", "pii/some-rule", "FIX_TEXT")]),
      }),
    ).toThrow(new RegExp(`${FRAMEWORK_RULES_PATH}.*"fix"`));
  });

  test("an id outside the <area>/<kebab> pattern throws", () => {
    expect(() =>
      render({ [FRAMEWORK_RULES_PATH]: rulesFile("A", [rule("a", "NoSlash")]) }),
    ).toThrow(/does not match/);
  });

  test("tables without the BootRuleTable satisfies are ignored", () => {
    const output = render({
      [FRAMEWORK_RULES_PATH]: "export const OTHER = { a: { id: 'x' } } as const;\n",
    });
    expect(output).toContain("No boot rules are registered yet.");
  });

  test("no rule files renders the note", () => {
    expect(render({})).toContain("No boot rules are registered yet.");
  });
});
