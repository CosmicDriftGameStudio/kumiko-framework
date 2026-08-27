#!/usr/bin/env bun
// Rewrites `import { resetPiiSubjectKmsForTests, resetBlindIndexKeyForTests }
// from "@cosmicdrift/kumiko-framework/crypto"` to import both names from
// "@cosmicdrift/kumiko-framework/testing" instead (fw#1631). Only the
// package barrel specifier is rewritten — relative deep-imports of the
// defining module are left untouched, per the changes.json migration note.
// Idempotent: an already-migrated file has nothing left to move.
//
// Usage: bun scripts/codemod/crypto-shredding-testing-move.ts <targetDir> [--dry-run]

import { type Dirent, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project, type SourceFile } from "ts-morph";

const OLD_SPECIFIER = "@cosmicdrift/kumiko-framework/crypto";
const NEW_SPECIFIER = "@cosmicdrift/kumiko-framework/testing";
const MOVED_NAMES = new Set(["resetPiiSubjectKmsForTests", "resetBlindIndexKeyForTests"]);

const EXCLUDE_DIRS = new Set(["node_modules", "dist", "build"]);

function findTargetFiles(rootDir: string): string[] {
  // Walk the tree and skip excluded dirs while descending — filtering the
  // absolute path after a full Glob scan silently no-ops when the repo root
  // itself contains "/build/" or "/node_modules/" (fw#2289).
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (EXCLUDE_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
        walk(join(dir, ent.name));
        continue;
      }
      if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
        files.push(join(dir, ent.name));
      }
    }
  };
  walk(rootDir);
  return files.sort();
}

/** Move matching value imports from crypto → testing. Returns count of names moved. */
function migrateFile(sourceFile: SourceFile): number {
  // Value imports only — a pre-existing `import type { … } from testing`
  // must not receive runtime helpers (they would be erased).
  const oldImports = sourceFile
    .getImportDeclarations()
    .filter((d) => d.getModuleSpecifierValue() === OLD_SPECIFIER && !d.isTypeOnly());
  if (oldImports.length === 0) return 0;

  let fileMoved = 0;
  for (const oldImport of oldImports) {
    const movedHere = oldImport.getNamedImports().filter((spec) => MOVED_NAMES.has(spec.getName()));
    if (movedHere.length === 0) continue;

    const names = movedHere.map((spec) => spec.getName());

    const existingNewImport = sourceFile
      .getImportDeclarations()
      .find((d) => d.getModuleSpecifierValue() === NEW_SPECIFIER && !d.isTypeOnly());
    if (existingNewImport) {
      const already = new Set(existingNewImport.getNamedImports().map((s) => s.getName()));
      for (const name of names) {
        if (!already.has(name)) existingNewImport.addNamedImport(name);
      }
    } else {
      sourceFile.addImportDeclaration({ moduleSpecifier: NEW_SPECIFIER, namedImports: names });
    }

    for (const spec of movedHere) spec.remove();
    const remaining =
      oldImport.getNamedImports().length > 0 ||
      !!oldImport.getDefaultImport() ||
      !!oldImport.getNamespaceImport();
    if (!remaining) oldImport.remove();

    fileMoved += names.length;
  }
  return fileMoved;
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");
  const rootDir = resolve(positional[0] ?? process.cwd());

  const files = findTargetFiles(rootDir);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  let touchedFiles = 0;
  let movedNames = 0;

  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    const fileMoved = migrateFile(sourceFile);
    if (fileMoved === 0) continue;

    touchedFiles++;
    movedNames += fileMoved;
    if (!dryRun) sourceFile.saveSync();
  }

  console.log(`\nScanned ${files.length} files under ${rootDir}${dryRun ? " (dry-run)" : ""}.`);
  console.log(
    `Touched ${touchedFiles} files, moved ${movedNames} import(s) from "${OLD_SPECIFIER}" to "${NEW_SPECIFIER}".\n`,
  );
}

await main();
