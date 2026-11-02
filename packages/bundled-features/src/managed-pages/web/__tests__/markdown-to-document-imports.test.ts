import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

const PACKAGE_ROOT = resolve(import.meta.dir, "../../../..");
const OWN_PACKAGE = "@cosmicdrift/kumiko-bundled-features";
// `from "x"` imports and re-exports as well as side-effect `import "x"`.
const IMPORT_SPECIFIER = /^\s*(?:import|export)\b(?:[^"']*?\sfrom\s*)?["']([^"']+)["']/gm;

function ownPackageExports(): Record<string, string> {
  const manifest: unknown = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8"));
  const exportsMap = isPlainObject(manifest) ? manifest["exports"] : undefined;
  if (!isPlainObject(exportsMap)) return {};
  return Object.fromEntries(
    Object.entries(exportsMap).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

const OWN_EXPORTS = ownPackageExports();

// Relative imports and self-imports through the package's own exports map stay inside the
// package source, so both have to be followed; everything else is an external leaf.
function sourceFileOf(specifier: string, importer: string): string | undefined {
  if (specifier.startsWith(".")) return resolve(dirname(importer), specifier);
  if (specifier !== OWN_PACKAGE && !specifier.startsWith(`${OWN_PACKAGE}/`)) return undefined;
  const target = OWN_EXPORTS[`.${specifier.slice(OWN_PACKAGE.length)}`];
  if (target === undefined) {
    throw new Error(`${importer}: self-import "${specifier}" is not in the package exports map`);
  }
  return resolve(PACKAGE_ROOT, target);
}

function staticImportClosure(entry: string): string[] {
  const seen = new Set<string>();
  const specifiers = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      specifiers.add(specifier);
      const next = sourceFileOf(specifier, file);
      if (next !== undefined) queue.push(next);
    }
  }
  return [...specifiers];
}

describe("managed-pages client bundle boundary", () => {
  test("markdown-to-document never statically reaches tiptap", () => {
    const entry = resolve(import.meta.dir, "../markdown-to-document.ts");
    expect(staticImportClosure(entry).filter((s) => s.startsWith("@tiptap"))).toEqual([]);
  });

  test("the closure follows self-imports through the exports map and side-effect imports", () => {
    const entry = resolve(import.meta.dir, "../../../template-resolver/web/document-schema.ts");
    expect(staticImportClosure(entry).some((s) => s.startsWith("@tiptap"))).toBe(true);
  });
});
