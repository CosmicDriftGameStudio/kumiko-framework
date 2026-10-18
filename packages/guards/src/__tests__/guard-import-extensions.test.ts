import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { guard } from "../guard-import-extensions";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  for (const [path, source] of Object.entries(map)) project.createSourceFile(path, source);
  return project.getSourceFiles();
}

const PATH = "packages/demo/src/feature.ts";

describe("Import-Extensions Guard", () => {
  test("flags relative .js and .jsx specifiers in import, export and dynamic import", () => {
    const { violations } = guard.run(
      files({
        [PATH]: [
          `import { a } from "./a.js";`,
          `import type { B } from "../b.js";`,
          `export { c } from "./c.js";`,
          `export * from "./d.jsx";`,
          `const e = await import("./e.js");`,
        ].join("\n"),
      }),
    );
    expect(violations.map((v) => v.line)).toEqual([1, 2, 3, 4, 5]);
    expect(violations[0]?.message).toContain("import-extensions");
  });

  test("accepts .ts/.tsx, extensionless, package and non-relative specifiers", () => {
    const { violations } = guard.run(
      files({
        [PATH]: [
          `import { a } from "./a.ts";`,
          `import { b } from "./b.tsx";`,
          `import { c } from "./c";`,
          `import { d } from "pkg/dist/d.js";`,
          `import data from "./data.json";`,
          `import { cli } from "../dist/release/cli.js";`,
          `export * from "./dist/index.js";`,
          `const note = "./not-an-import.js";`,
        ].join("\n"),
      }),
    );
    expect(violations).toEqual([]);
  });

  test("ignores declaration files and fixtures", () => {
    const { violations } = guard.run(
      files({
        "packages/demo/src/types.d.ts": `export * from "./a.js";`,
        "packages/demo/src/__tests__/fixtures/old.input.ts": `import { a } from "./a.js";`,
      }),
    );
    expect(violations).toEqual([]);
  });
});
