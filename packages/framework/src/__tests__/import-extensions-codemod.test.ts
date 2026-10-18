import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformImportExtensionsSource } from "../scripts/codemod/import-extensions.ts";

let root = "";
let importer = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "import-extensions-"));
  mkdirSync(join(root, "lib"));
  for (const file of ["a.ts", "lib/b.ts", "View.tsx", "only.js"]) {
    writeFileSync(join(root, file), "export {};\n");
  }
  importer = join(root, "main.ts");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("import-extensions codemod", () => {
  it("rewrites import, export from, import type, import() and mock.module", () => {
    const input = [
      `import { a } from "./a.js";`,
      `import type { B } from "./lib/b.js";`,
      `export { a as again } from "./a.js";`,
      `const lazy = await import("./lib/b.js");`,
      `mock.module("./a.js", () => ({}));`,
      ``,
    ].join("\n");
    const result = transformImportExtensionsSource(input, importer);
    expect(result.output).toBe(input.replaceAll(".js", ".ts"));
    expect(result.rewrites).toHaveLength(5);
    expect(result.manual).toHaveLength(0);
  });

  it("maps .jsx to .tsx and a .js specifier of a .tsx file to .tsx", () => {
    const result = transformImportExtensionsSource(
      `import { V } from "./View.jsx";\nimport { W } from "./View.js";\n`,
      importer,
    );
    expect(result.output).toBe(
      `import { V } from "./View.tsx";\nimport { W } from "./View.tsx";\n`,
    );
  });

  it("reports a specifier without a .ts target and leaves it alone", () => {
    const input = `import { x } from "./only.js";\nimport { y } from "./missing.js";\n`;
    const result = transformImportExtensionsSource(input, importer);
    expect(result.output).toBe(input);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual.map((site) => site.line)).toEqual([1, 2]);
  });

  it("ignores package specifiers, extensionless specifiers and plain strings", () => {
    const input = [
      `import { p } from "pkg/dist/p.js";`,
      `import { a } from "./a";`,
      `const note = "./a.js";`,
      ``,
    ].join("\n");
    const result = transformImportExtensionsSource(input, importer);
    expect(result.output).toBe(input);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(0);
  });
});
