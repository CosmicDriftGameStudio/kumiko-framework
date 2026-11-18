import { describe, expect, it } from "bun:test";
import { transformGuardMarkersSource } from "../scripts/codemod/guard-markers-to-lint-ignore.ts";

const FILE = "/repo/apps/demo/e2e/sample.spec.ts";

const REWRITE_FIXTURES: readonly {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}[] = [
  {
    name: "@no-server-stack becomes the file-wide form",
    input: "// @no-server-stack: pure redis adapter test, no server needed\nimport x from 'x';\n",
    expected:
      "// kumiko-lint-ignore-file test-stack-drift pure redis adapter test, no server needed\nimport x from 'x';\n",
  },
  {
    name: "@timeout-exception becomes the line form",
    input: "// @timeout-exception: #3118 sidecar cold start takes 40s\ntest.setTimeout(60_000);\n",
    expected:
      "// kumiko-lint-ignore test-timeouts #3118 sidecar cold start takes 40s\ntest.setTimeout(60_000);\n",
  },
  {
    name: "@template-drift-exception becomes the line form",
    input:
      "  // @template-drift-exception: #3372 ad hoc local debug dump\n  await page.screenshot();\n",
    expected:
      "  // kumiko-lint-ignore test-template-drift #3372 ad hoc local debug dump\n  await page.screenshot();\n",
  },
  {
    name: "a trailing marker after code",
    input: "while (!ready()) { // @timeout-exception: #12 external queue has no callback\n",
    expected:
      "while (!ready()) { // kumiko-lint-ignore test-timeouts #12 external queue has no callback\n",
  },
  {
    name: "a marker inside a block comment",
    input: "/*\n * @no-server-stack: boot-time code without an HTTP route\n */\n",
    expected:
      "/*\n * kumiko-lint-ignore-file test-stack-drift boot-time code without an HTTP route\n */\n",
  },
];

describe("guard-markers-to-lint-ignore codemod", () => {
  for (const fixture of REWRITE_FIXTURES) {
    it(`rewrites: ${fixture.name}`, () => {
      const result = transformGuardMarkersSource(fixture.input, FILE);

      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(1);
      expect(result.manual).toHaveLength(0);
    });

    it(`${fixture.name}: a second run changes nothing`, () => {
      const second = transformGuardMarkersSource(fixture.expected, FILE);

      expect(second.output).toBe(fixture.expected);
      expect(second.rewrites).toHaveLength(0);
    });
  }

  it("rewrites all three markers of one file and reports each line", () => {
    const input = [
      "// @no-server-stack: boot-time code without an HTTP route",
      "// @timeout-exception: #1 sidecar cold start",
      "// @template-drift-exception: #2 debug dump",
      "",
    ].join("\n");

    const result = transformGuardMarkersSource(input, FILE);

    expect(result.output).toBe(
      [
        "// kumiko-lint-ignore-file test-stack-drift boot-time code without an HTTP route",
        "// kumiko-lint-ignore test-timeouts #1 sidecar cold start",
        "// kumiko-lint-ignore test-template-drift #2 debug dump",
        "",
      ].join("\n"),
    );
    expect(result.rewrites.map((site) => site.line)).toEqual([1, 2, 3]);
  });

  it("leaves a marker without a comment prefix alone", () => {
    const input = 'const note = "see @timeout-exception: #1 in the docs";\n';

    const result = transformGuardMarkersSource(input, FILE);

    expect(result.output).toBe(input);
    expect(result.rewrites).toHaveLength(0);
  });

  it("leaves comment-like marker text inside string and template literals alone", () => {
    const input = [
      'const lineMarker = "// @timeout-exception: #1 fixture";',
      "const blockMarker = `",
      " * @no-server-stack: fixture inside a template",
      "`;",
      "// @template-drift-exception: #2 real marker",
      "",
    ].join("\n");

    const result = transformGuardMarkersSource(input, FILE);

    expect(result.output).toBe(
      input.replace("// @template-drift-exception: ", "// kumiko-lint-ignore test-template-drift "),
    );
    expect(result.rewrites.map((site) => site.line)).toEqual([5]);
  });

  it("leaves a file without markers alone", () => {
    const input = "export const answer = 42;\n";

    const result = transformGuardMarkersSource(input, FILE);

    expect(result.output).toBe(input);
    expect(result.rewrites).toHaveLength(0);
  });
});
