#!/usr/bin/env bun
// Rewrites `import { resetPiiSubjectKmsForTests, resetBlindIndexKeyForTests }
// from "@cosmicdrift/kumiko-framework/crypto"` to import both names from
// "@cosmicdrift/kumiko-framework/testing" instead (fw#1631). Only the
// package barrel specifier is rewritten — relative deep-imports of the
// defining module are left untouched, per the changes.json migration note.
// Idempotent: an already-migrated file has nothing left to move.
//
// Usage: bun scripts/codemod/crypto-shredding-testing-move.ts <targetDir> [--dry-run]

import { resolve } from "node:path";
import { Glob } from "bun";
import { Project } from "ts-morph";

const OLD_SPECIFIER = "@cosmicdrift/kumiko-framework/crypto";
const NEW_SPECIFIER = "@cosmicdrift/kumiko-framework/testing";
const MOVED_NAMES = new Set(["resetPiiSubjectKmsForTests", "resetBlindIndexKeyForTests"]);

function findTargetFiles(rootDir: string): string[] {
  const glob = new Glob("**/*.{ts,tsx}");
  const EXCLUDE = ["/node_modules/", "/dist/", "/build/"];
  const files: string[] = [];
  for (const file of glob.scanSync({ cwd: rootDir, dot: false })) {
    const abs = resolve(rootDir, file);
    if (EXCLUDE.some((p) => abs.includes(p))) continue;
    files.push(abs);
  }
  return files.sort();
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");
  const rootDir = resolve(positional[0] ?? process.cwd());

  const files = findTargetFiles(rootDir);
  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });

  let touchedFiles = 0;
  let movedNames = 0;

  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    const oldImport = sourceFile.getImportDeclarations().find((d) => d.getModuleSpecifierValue() === OLD_SPECIFIER);
    if (!oldImport) continue;

    const movedHere = oldImport.getNamedImports().filter((spec) => MOVED_NAMES.has(spec.getName()));
    if (movedHere.length === 0) continue;

    const names = movedHere.map((spec) => spec.getName());

    const existingNewImport = sourceFile
      .getImportDeclarations()
      .find((d) => d.getModuleSpecifierValue() === NEW_SPECIFIER);
    if (existingNewImport) {
      const already = new Set(existingNewImport.getNamedImports().map((s) => s.getName()));
      for (const name of names) {
        if (!already.has(name)) existingNewImport.addNamedImport(name);
      }
    } else {
      sourceFile.addImportDeclaration({ moduleSpecifier: NEW_SPECIFIER, namedImports: names });
    }

    for (const spec of movedHere) spec.remove();
    const remaining = oldImport.getNamedImports().length > 0 || !!oldImport.getDefaultImport() || !!oldImport.getNamespaceImport();
    if (!remaining) oldImport.remove();

    touchedFiles++;
    movedNames += names.length;
    if (!dryRun) sourceFile.saveSync();
  }

  console.log(`\nScanned ${files.length} files under ${rootDir}${dryRun ? " (dry-run)" : ""}.`);
  console.log(`Touched ${touchedFiles} files, moved ${movedNames} import(s) from "${OLD_SPECIFIER}" to "${NEW_SPECIFIER}".\n`);
}

await main();
