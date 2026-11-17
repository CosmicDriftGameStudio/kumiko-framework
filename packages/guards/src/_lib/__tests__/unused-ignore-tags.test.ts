import { describe, expect, test } from "bun:test";
import { Project, SyntaxKind } from "ts-morph";
import type { RepoKind } from "../../../repo-manifest/index.ts";
import { guard as i18nUiStringsGuard } from "../../guard-i18n-ui-strings";
import { type AstGuard, type RunResult, runGuards } from "../guard-kit";
import { hasIgnoreTag } from "../ignore-tag";
import type { RepoRoot } from "../roots";
import type { RootScan, ScanSpec } from "../scan-scope";
import { UNUSED_IGNORE_TAGS_CHECK } from "../unused-ignore-tags";

const SOURCE_SPEC: ScanSpec = { scope: "source", extensions: ["ts", "tsx"] };
const DEMO_TAG = "kumiko-lint-ignore demo-slug";

function repoRoot(name: string, absPath: string, kind: RepoKind = "app"): RepoRoot {
  return {
    name,
    absPath,
    kind,
    manifest: { kind, sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] },
    manifestSource: "derived",
  };
}

function fixedScan(
  root: RepoRoot,
  files: readonly string[],
): (guard: AstGuard, roots: readonly RepoRoot[]) => readonly RootScan[] {
  return () => [{ root, files, sourceSurface: files.length }];
}

const demoGuard: AstGuard = {
  name: "demo",
  ignoreTag: DEMO_TAG,
  scan: SOURCE_SPEC,
  run: (files) => ({
    violations: files.flatMap((sf) =>
      sf
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((call) => call.getExpression().getText() === "flagMe")
        .filter((call) => !hasIgnoreTag(call, DEMO_TAG))
        .map((call) => ({
          file: sf.getFilePath(),
          line: call.getStartLineNumber(),
          message: "flagMe() call",
        })),
    ),
  }),
};

function runWith(
  guards: readonly AstGuard[],
  sources: Readonly<Record<string, string>>,
): RunResult[] {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(sources)) project.createSourceFile(path, text);
  const root = repoRoot("demo-app", "/repo");
  return runGuards(guards, project, {
    roots: [root],
    scan: fixedScan(root, Object.keys(sources)),
  });
}

function unusedResult(results: readonly RunResult[]): RunResult | undefined {
  return results.find((r) => r.name === UNUSED_IGNORE_TAGS_CHECK);
}

describe("unused-ignore-tags", () => {
  test("reports only the marker that suppressed nothing", () => {
    const results = runWith([demoGuard], {
      "/repo/src/a.ts": [
        "// kumiko-lint-ignore demo-slug the call is intentional here",
        "flagMe();",
        "// kumiko-lint-ignore demo-slug nothing to suppress below this line",
        "const x = 1;",
        "export { x };",
      ].join("\n"),
    });
    expect(results.find((r) => r.name === "demo")?.outcome?.violations).toHaveLength(0);
    const unused = unusedResult(results);
    expect(unused?.ok).toBe(false);
    expect(unused?.outcome?.violations).toHaveLength(1);
    expect(unused?.outcome?.violations[0]?.line).toBe(3);
  });

  test("a multi-slug marker counts when its slug list contains the guard's slug", () => {
    const used = runWith([demoGuard], {
      "/repo/src/a.ts":
        "// kumiko-lint-ignore other-slug,demo-slug a reason with several words\nflagMe();\n",
    });
    expect(unusedResult(used)?.outcome?.violations).toHaveLength(0);

    const dead = runWith([demoGuard], {
      "/repo/src/a.ts":
        "// kumiko-lint-ignore other-slug,demo-slug a reason with several words\nexport const x = 1;\n",
    });
    const violations = unusedResult(dead)?.outcome?.violations ?? [];
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("demo-slug");
  });

  test("a guard that throws reports none of its markers", () => {
    const throwing: AstGuard = {
      name: "throwing",
      ignoreTag: DEMO_TAG,
      scan: SOURCE_SPEC,
      run: () => {
        throw new Error("boom");
      },
    };
    const results = runWith([throwing], {
      "/repo/src/a.ts": "// kumiko-lint-ignore demo-slug a reason with several words\nexport const x = 1;\n",
    });
    expect(results.find((r) => r.name === "throwing")?.ok).toBe(false);
    expect(unusedResult(results)?.outcome?.violations).toHaveLength(0);
  });

  test("a placeholder marker in a doc comment is skipped", () => {
    const results = runWith([demoGuard], {
      "/repo/src/a.ts": "/** Use `kumiko-lint-ignore demo-slug <reason>` to allow a call. */\nexport const x = 1;\n",
    });
    expect(unusedResult(results)?.outcome?.violations).toHaveLength(0);
  });

  test("no unused-ignore-tags result when no guard declares an ignoreTag", () => {
    const plain: AstGuard = { name: "plain", scan: SOURCE_SPEC, run: () => ({ violations: [] }) };
    const results = runWith([plain], { "/repo/src/a.ts": "export const x = 1;\n" });
    expect(unusedResult(results)).toBeUndefined();
  });

  test("real i18n-ui-strings guard: a marker above an exempt header title is unused", () => {
    const results = runWith([i18nUiStringsGuard], {
      "/repo/src/web/page.tsx": [
        "export const screen = r.screen({",
        "  // kumiko-lint-ignore i18n-ui-strings brand name stays untranslated in every locale",
        '  header: { title: "Acme" },',
        "});",
        "export const view = () => (",
        "  <div>",
        "    {/* kumiko-lint-ignore i18n-ui-strings brand name stays untranslated in every locale */}",
        "    <p>Hello world</p>",
        "  </div>",
        ");",
      ].join("\n"),
    });
    expect(results.find((r) => r.name === i18nUiStringsGuard.name)?.outcome?.violations).toHaveLength(0);
    const violations = unusedResult(results)?.outcome?.violations ?? [];
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
  });
});
