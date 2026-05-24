#!/usr/bin/env bun
// Codemod-pass-3: swap framework/db → framework/bun-db Imports für
// die helper-Symbole. Mixed imports werden in zwei import-Statements
// gesplittet.
//
// Helpers die zu bun-db gehören (gleiche Signatur dort):
//   - selectMany, fetchOne, insertOne, updateMany, deleteMany, transaction
//   - WhereObject, WhereValue, SelectOptions (Types)
//
// Alles andere bleibt aus framework/db (DbConnection, createTenantDb,
// EntityTableMeta, etc.).

import { Project, SyntaxKind } from "ts-morph";

const APPLY = process.argv.includes("--apply");
const ROOTS = ["packages/bundled-features/src", "packages/framework/src"];

const BUN_DB_SYMBOLS = new Set([
  "selectMany",
  "fetchOne",
  "insertOne",
  "updateMany",
  "deleteMany",
  "transaction",
  "WhereObject",
  "WhereValue",
  "SelectOptions",
]);

const SRC_MODULE = "@cosmicdrift/kumiko-framework/db";
const DST_MODULE = "@cosmicdrift/kumiko-framework/bun-db";

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
  skipAddingFilesFromTsConfig: true,
});
for (const root of ROOTS) project.addSourceFilesAtPaths([`${root}/**/*.ts`]);

let totalEdits = 0;
let filesTouched = 0;

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  if (filePath.includes("/dist/") || filePath.includes("/bun-db/")) continue;

  // db barrel-export-file selbst überspringen
  if (filePath.endsWith("/db/index.ts")) continue;

  const dbImports = sourceFile
    .getImportDeclarations()
    .filter((i) => i.getModuleSpecifierValue() === SRC_MODULE);
  if (dbImports.length === 0) continue;

  let edited = false;
  for (const imp of dbImports) {
    const isTypeOnly = imp.isTypeOnly();
    const named = imp.getNamedImports();
    const toMove: { name: string; isType: boolean }[] = [];
    const toKeep: { name: string; isType: boolean }[] = [];
    for (const ni of named) {
      const name = ni.getName();
      const niIsType = ni.isTypeOnly() || isTypeOnly;
      (BUN_DB_SYMBOLS.has(name) ? toMove : toKeep).push({ name, isType: niIsType });
    }
    if (toMove.length === 0) continue;
    edited = true;

    if (toKeep.length === 0 && !imp.getDefaultImport()) {
      // Alle imports wandern zu bun-db — modifier des bestehenden statements
      imp.setModuleSpecifier(DST_MODULE);
    } else {
      // Mixed: remove die toMove names aus dem alten import, add new bun-db import
      for (const m of toMove) {
        const ni = imp.getNamedImports().find((n) => n.getName() === m.name);
        if (ni) ni.remove();
      }
      sourceFile.addImportDeclaration({
        moduleSpecifier: DST_MODULE,
        namedImports: toMove.map((m) => ({ name: m.name, isTypeOnly: m.isType })),
      });
    }
  }

  if (edited) {
    totalEdits++;
    filesTouched++;
    console.log(`${filePath.replace(`${process.cwd()}/`, "")}`);
  }
}

console.log("");
console.log(`Total: ${filesTouched} files swapped.`);
if (APPLY) {
  await project.save();
  console.log("Saved.");
} else {
  console.log("Dry-run (use --apply to write).");
}
