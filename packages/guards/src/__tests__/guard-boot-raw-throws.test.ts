import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard, rawErrorThrowLines } from "../guard-boot-raw-throws";

function linesOf(source: string): number[] {
  const project = new Project({ useInMemoryFileSystem: true });
  return rawErrorThrowLines(project.createSourceFile("validator.ts", source));
}

describe("rawErrorThrowLines", () => {
  test("counts every throw new Error with its line", () => {
    const source = [
      "export function a(x: number) {",
      '  if (x > 1) throw new Error("big");',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text for the guard, the template literal is the input
      "  throw new Error(`small ${x}`);",
      "}",
    ].join("\n");
    expect(linesOf(source)).toEqual([2, 3]);
  });

  test("ignores bootRuleError, other error classes, comments and strings", () => {
    const source = [
      'import { bootRuleError } from "./boot-rule.ts";',
      "export function a() {",
      '  // throw new Error("commented");',
      '  const text = "throw new Error(x)";',
      "  if (text) throw bootRuleError(RULE, { message: text });",
      '  throw new TypeError("crash");',
      "}",
    ].join("\n");
    expect(linesOf(source)).toEqual([]);
  });

  test("the guard scans boot validation sources only", () => {
    expect(guard.name).toBe("boot-raw-throws");
    expect(guard.scan.frameworkWithin).toEqual([
      "packages/framework/src/engine/boot-validator/**",
      "packages/bundled-features/src/*/boot-checks.ts",
    ]);
  });
});
