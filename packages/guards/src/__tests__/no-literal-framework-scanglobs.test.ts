/**
 * Meta-guards for the manifest-driven scan API.
 *
 * 1. No guard-*.ts file may reference the removed pre-manifest mechanics
 *    (scanGlobs/SCAN_GLOBS/allRepos/expandLegacyGlobs/flatSrcGlobs), replaced
 *    by `ScanSpec` + `scanRoots()` (_lib/scan-scope.ts). Checked via ts-morph
 *    identifiers, not text-grep, so a doc-comment mentioning one of these
 *    names isn't a false positive.
 * 2. Every AstGuard in GUARDS/UI_GUARDS declares a `scan: ScanSpec` with a
 *    valid scope and at least one extension.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import { GUARDS } from "../run-guards";
import { UI_GUARDS } from "../run-ui-guards";

const GUARDS_DIR = join(import.meta.dir, "..");
const FORBIDDEN_IDENTIFIERS = [
  "scanGlobs",
  "SCAN_GLOBS",
  "allRepos",
  "expandLegacyGlobs",
  "flatSrcGlobs",
];

function guardFiles(): string[] {
  return readdirSync(GUARDS_DIR)
    .filter((f) => /^guard-.*\.ts$/.test(f))
    .map((f) => join(GUARDS_DIR, f));
}

function forbiddenIdentifiersIn(filePath: string): string[] {
  const project = new Project({ useInMemoryFileSystem: false });
  const sf = project.addSourceFileAtPath(filePath);
  const found = new Set<string>();
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const text = id.getText();
    if (FORBIDDEN_IDENTIFIERS.includes(text)) found.add(text);
  }
  return [...found];
}

describe("no scanGlobs/allRepos/legacy-glob-expansion leftovers in guard-*.ts", () => {
  for (const filePath of guardFiles()) {
    const name = filePath.split("/").at(-1) ?? filePath;
    test(name, () => {
      expect(forbiddenIdentifiersIn(filePath)).toEqual([]);
    });
  }
});

const VALID_SCAN_SCOPES = new Set(["source", "tests"]);

describe("every registered AstGuard declares a valid scan spec", () => {
  for (const guard of [...GUARDS, ...UI_GUARDS]) {
    test(guard.name, () => {
      expect(VALID_SCAN_SCOPES.has(guard.scan.scope)).toBe(true);
      expect(guard.scan.extensions.length).toBeGreaterThan(0);
    });
  }
});
