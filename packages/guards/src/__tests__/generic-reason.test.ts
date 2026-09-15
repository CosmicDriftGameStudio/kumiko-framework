import { describe, expect, test } from "bun:test";
import { Project, SyntaxKind } from "ts-morph";
import { isGenericReason, literalReasonText } from "../_lib/generic-reason";

describe("isGenericReason", () => {
  test.each([
    "",
    "   ",
    "todo",
    "TODO",
    "Legacy.",
    "legacy",
    "temp",
    "temporary",
    "hack",
    "wip",
    "fixme",
    "tbd",
    "n/a",
    "na",
    "none",
    "-",
    "?",
    "reason",
    "xxx",
    "todo: fix later",
    "TODO: fix later",
    "fixme: revisit",
    "tbd: decide later",
  ])("%p is generic", (text) => {
    expect(isGenericReason(text)).toBe(true);
  });

  test.each([
    "cross-tenant job monitoring",
    "SystemAdmin lists tenants platform-wide",
    "creating a tenant is inherently cross-tenant",
    "cleanup of orphaned rows",
  ])("%p is not generic", (text) => {
    expect(isGenericReason(text)).toBe(false);
  });
});

function firstArgOf(code: string): ReturnType<typeof literalReasonText> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/r/x.ts", code);
  const call = sf.getFirstDescendantByKindOrThrow(SyntaxKind.CallExpression);
  return literalReasonText(call.getArguments()[0]);
}

describe("literalReasonText", () => {
  test("reads a string literal", () => {
    expect(firstArgOf('f("legacy migration hack");')).toBe("legacy migration hack");
  });

  test("reads a no-substitution template literal", () => {
    expect(firstArgOf("f(`legacy migration`);")).toBe("legacy migration");
  });

  test("returns undefined for a template literal with a substitution", () => {
    expect(firstArgOf("declare const x: string;\nf(`reason: ${x}`);")).toBe(undefined);
  });

  test("returns undefined for an identifier argument", () => {
    expect(firstArgOf("declare const reason: string;\nf(reason);")).toBe(undefined);
  });

  test("returns undefined for a call expression argument", () => {
    expect(firstArgOf("declare function g(): string;\nf(g());")).toBe(undefined);
  });

  test("returns undefined for a missing argument", () => {
    expect(firstArgOf("f();")).toBe(undefined);
  });
});
