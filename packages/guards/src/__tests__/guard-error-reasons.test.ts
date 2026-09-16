import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-error-reasons";

function parse(source: string, file: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(file, source);
}

describe("guard-error-reasons", () => {
  test("does not flag a declareEscapeHatch reason (prose, not a reason code)", () => {
    const sf = parse(
      `declare function declareEscapeHatch(d: unknown): void;
declareEscapeHatch({ reason: "some prose justification with spaces" });`,
      "packages/framework/src/x/handler.ts",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("still flags an ordinary details.reason with prose", () => {
    const sf = parse(
      `export const fail = () => ({ details: { reason: "some prose" } });`,
      "packages/framework/src/x/handler.ts",
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain('details.reason "some prose"');
  });
});
