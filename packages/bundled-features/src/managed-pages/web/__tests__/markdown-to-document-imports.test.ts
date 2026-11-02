import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const IMPORT_SPECIFIER = /^\s*(?:import|export)\b[^"']*?from\s+["']([^"']+)["']/gm;

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
      if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier));
    }
  }
  return [...specifiers];
}

describe("managed-pages client bundle boundary", () => {
  test("markdown-to-document never statically reaches tiptap", () => {
    const entry = resolve(import.meta.dir, "../markdown-to-document.ts");
    expect(staticImportClosure(entry).filter((s) => s.startsWith("@tiptap"))).toEqual([]);
  });
});
