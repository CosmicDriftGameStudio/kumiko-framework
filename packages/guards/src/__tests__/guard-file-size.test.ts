import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { MAX_FILE_LINES, oversizedFileLines } from "../guard-file-size";

const ROOTS = [{ absPath: "/repo" }];

function countsFor(files: Record<string, number>): Record<string, number> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sources = Object.entries(files).map(([filePath, lines]) =>
    project.createSourceFile(filePath, "export const line = 1;\n".repeat(lines)),
  );
  return oversizedFileLines(sources, ROOTS);
}

describe("File Size guard", () => {
  test("counts a file above the threshold, not one exactly at it", () => {
    const counts = countsFor({
      "/repo/packages/a/src/over.ts": MAX_FILE_LINES + 1,
      "/repo/packages/a/src/at.ts": MAX_FILE_LINES,
    });
    expect(counts).toEqual({ "packages/a/src/over.ts": MAX_FILE_LINES + 1 });
  });

  test("ignores tests, declaration files, generated files and locale strings", () => {
    const big = MAX_FILE_LINES + 1;
    const counts = countsFor({
      "/repo/packages/a/src/__tests__/big.ts": big,
      "/repo/packages/a/src/big.test.ts": big,
      "/repo/packages/a/src/big.d.ts": big,
      "/repo/packages/a/src/big.generated.ts": big,
      "/repo/packages/locale-de/src/strings.ts": big,
    });
    expect(counts).toEqual({});
  });
});
