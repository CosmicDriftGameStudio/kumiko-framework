import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { dataTestidCounts } from "../guard-data-testid";

const ROOTS = [{ absPath: "/repo" }];

function countsFor(files: Record<string, string>): Record<string, number> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sources = Object.entries(files).map(([filePath, code]) =>
    project.createSourceFile(filePath, code),
  );
  return dataTestidCounts(sources, ROOTS);
}

describe("Data-Testid guard", () => {
  test("counts data-testid and data-test JSX attributes", () => {
    const counts = countsFor({
      "/repo/packages/a/src/view.tsx":
        'export const V = () => <div data-testid="a"><span data-test="b" /></div>;',
    });
    expect(counts).toEqual({ "packages/a/src/view.tsx": 2 });
  });

  test("counts the object-key form used in spread props", () => {
    const counts = countsFor({
      "/repo/packages/a/src/rail.tsx":
        'export const props = (id?: string) => ({ ...(id !== undefined && { "data-testid": id }) });',
    });
    expect(counts).toEqual({ "packages/a/src/rail.tsx": 1 });
  });

  test("ignores test files", () => {
    const code = 'export const V = () => <div data-testid="a" />;';
    const counts = countsFor({
      "/repo/packages/a/src/__tests__/view.tsx": code,
      "/repo/packages/a/src/view.test.tsx": code,
    });
    expect(counts).toEqual({});
  });

  test("ignores other attributes and omits files without hits", () => {
    const counts = countsFor({
      "/repo/packages/a/src/clean.tsx":
        'export const V = () => <div aria-label="x" data-state="open" />;',
    });
    expect(counts).toEqual({});
  });
});
