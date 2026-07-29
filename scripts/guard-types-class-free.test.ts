import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { join } from "node:path";

// kumiko-types is a plain dependency, so a consumer may end up resolving two
// copies of it. That is only safe while nothing in it carries runtime identity:
// an `instanceof` against a class from the other copy is false, and a bare
// Symbol() brand from the other copy does not match either — the exact shape
// that let a Secret slip past assertNoSecretLeak in #1633. Anything identity-
// sensitive belongs in kumiko-framework (#1629), which is a single copy.

const TYPES_SRC = join(import.meta.dir, "..", "packages", "types", "src");

function sourceFiles(): string[] {
  return [...new Glob("**/*.ts").scanSync({ cwd: TYPES_SRC })]
    .filter((f) => !f.endsWith(".test.ts"))
    .sort();
}

function codeWithoutComments(file: string): string {
  return readFileSync(join(TYPES_SRC, file), "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function offenders(pattern: RegExp): string[] {
  return sourceFiles().filter((file) => pattern.test(codeWithoutComments(file)));
}

describe("kumiko-types stays free of runtime identity", () => {
  it("declares no classes", () => {
    expect(offenders(/^\s*(export\s+)?(abstract\s+)?class\s/m)).toEqual([]);
  });

  it("uses Symbol.for, never a per-copy Symbol()", () => {
    expect(offenders(/(?<!\.)\bSymbol\s*\(/)).toEqual([]);
  });

  // Two copies mean two stores: a write through one is invisible through the
  // other, and unlike a failed instanceof this surfaces as missing data rather
  // than as an error.
  it("holds no module-scope mutable state", () => {
    expect(offenders(/^(export\s+)?(const|let|var)\s+\w+[^=\n]*=\s*(new (Map|Set|WeakMap|WeakSet)\b|[[{])/m)).toEqual(
      [],
    );
    expect(offenders(/^(export\s+)?(let|var)\s/m)).toEqual([]);
  });
});
