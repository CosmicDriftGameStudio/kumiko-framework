import { describe, expect, test } from "bun:test";
import { Project, ts } from "ts-morph";
import { featureCycleFindings } from "../guard-feature-import-cycles";

const FEATURE_DIR = /^\/repo\/src\/features\/([^/]+)\//;

function featureOf(absPath: string): string | null {
  return FEATURE_DIR.exec(absPath)?.[1] ?? null;
}

function findingsFor(files: Record<string, string>): Record<string, number> {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
  const sources = Object.entries(files).map(([filePath, text]) =>
    project.createSourceFile(filePath, text),
  );
  return featureCycleFindings(sources, featureOf);
}

const A = "/repo/src/features/a/x.ts";
const B = "/repo/src/features/b/y.ts";
const C = "/repo/src/features/c/z.ts";

describe("Feature Import Cycles guard", () => {
  test("a two-feature runtime cycle counts both sides", () => {
    const counts = findingsFor({
      [A]: `import { v } from "../b/y.ts";\nexport const u = v;\n`,
      [B]: `import { u } from "../a/x.ts";\nexport const v = u;\n`,
    });
    expect(counts).toEqual({ [A]: 1, [B]: 1 });
  });

  test("a three-feature cycle counts every file", () => {
    const counts = findingsFor({
      [A]: `import { b } from "../b/y.ts";\nexport const a = b;\n`,
      [B]: `import { c } from "../c/z.ts";\nexport const b = c;\n`,
      [C]: `import { a } from "../a/x.ts";\nexport const c = a;\n`,
    });
    expect(counts).toEqual({ [A]: 1, [B]: 1, [C]: 1 });
  });

  test("a one-way dependency is clean", () => {
    const counts = findingsFor({
      [A]: `import { v } from "../b/y.ts";\nexport const u = v;\n`,
      [B]: `export const v = 1;\n`,
    });
    expect(counts).toEqual({});
  });

  test("a type-only way back does not close the cycle", () => {
    const base = `import { v } from "../b/y.ts";\nexport const u = v;\nexport type T = number;\n`;
    expect(
      findingsFor({ [A]: base, [B]: `import type { T } from "../a/x.ts";\nexport const v: T = 1;\n` }),
    ).toEqual({});
    expect(
      findingsFor({ [A]: base, [B]: `import { type T } from "../a/x.ts";\nexport const v: T = 1;\n` }),
    ).toEqual({});
  });

  test("a re-export way back counts", () => {
    const counts = findingsFor({
      [A]: `import { v } from "../b/y.ts";\nexport const u = v;\n`,
      [B]: `export { u as v } from "../a/x.ts";\n`,
    });
    expect(counts).toEqual({ [A]: 1, [B]: 1 });
  });

  test("a dynamic import way back is ignored", () => {
    const counts = findingsFor({
      [A]: `import { v } from "../b/y.ts";\nexport const u = v;\n`,
      [B]: `export const v = async () => import("../a/x.ts");\n`,
    });
    expect(counts).toEqual({});
  });

  test("a line marker on the way-back import removes the edge", () => {
    const counts = findingsFor({
      [A]: `import { v } from "../b/y.ts";\nexport const u = v;\n`,
      [B]: `// kumiko-lint-ignore feature-import-cycles cycle broken in next refactor\nimport { u } from "../a/x.ts";\nexport const v = u;\n`,
    });
    expect(counts).toEqual({});
  });
});
