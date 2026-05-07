#!/usr/bin/env bun
// @runtime tooling
// migrate-rename-table-ddl — Stufe 1 von table-ddl-guard.md.
//
// Renames pushTables / createEntityTable / ensureEntityTable to their
// unsafe-prefixed variants across framework + samples + sibling workspaces.
//
// Strategy: pure AST rewrite, no symbol resolution. The three identifiers
// are unique enough across the codebase that an AST-based rewrite (filter
// import-specifier + body identifier per file) is safer than relying on
// cross-package module resolution through node_modules symlinks.
//
// Plan: kumiko-platform/docs/plans/architecture/table-ddl-guard.md
//
// Usage:
//   bun scripts/migrate-rename-table-ddl.ts --dry-run   # report only
//   bun scripts/migrate-rename-table-ddl.ts             # apply

import { resolve } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";

const FRAMEWORK_ROOT = resolve(import.meta.dir, "..");
const PARENT_ROOT = resolve(FRAMEWORK_ROOT, "..");

const DRY_RUN = process.argv.includes("--dry-run");

const RENAMES: Record<string, string> = {
  pushTables: "unsafePushTables",
  createEntityTable: "unsafeCreateEntityTable",
  ensureEntityTable: "unsafeEnsureEntityTable",
};

const OLD_NAMES = new Set(Object.keys(RENAMES));

const SOURCE_GLOBS = [
  `${FRAMEWORK_ROOT}/packages/*/src/**/*.ts`,
  `${FRAMEWORK_ROOT}/samples/**/*.ts`,
  `${FRAMEWORK_ROOT}/bin/**/*.ts`,
  `${PARENT_ROOT}/kumiko-studio/src/**/*.ts`,
  `${PARENT_ROOT}/publicstatus/src/**/*.ts`,
  `${PARENT_ROOT}/publicstatus/bin/**/*.ts`,
];

const EXCLUDE_PATH_PARTS = ["/node_modules/", "/dist/", "/.kumiko/"];

const project = new Project({ skipFileDependencyResolution: true });
for (const glob of SOURCE_GLOBS) {
  project.addSourceFilesAtPaths(glob);
}

const sourceFiles = project
  .getSourceFiles()
  .filter((sf) => !EXCLUDE_PATH_PARTS.some((p) => sf.getFilePath().includes(p)));

console.log(`[scan] ${sourceFiles.length} source files`);

let edits = 0;
const filesEdited = new Set<string>();

function isPropertyAccessName(node: Node): boolean {
  const parent = node.getParent();
  if (!parent || parent.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
  const pae = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  return pae.getNameNode() === node;
}

function isPropertyKey(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  const pk = parent.getKind();
  if (pk === SyntaxKind.PropertyAssignment) {
    return parent.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode() === node;
  }
  if (pk === SyntaxKind.ShorthandPropertyAssignment) return true;
  if (pk === SyntaxKind.PropertySignature) {
    return parent.asKindOrThrow(SyntaxKind.PropertySignature).getNameNode() === node;
  }
  if (pk === SyntaxKind.MethodSignature) {
    return parent.asKindOrThrow(SyntaxKind.MethodSignature).getNameNode() === node;
  }
  return false;
}

function isImportOrExportSpecifierLeaf(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  const pk = parent.getKind();
  return pk === SyntaxKind.ImportSpecifier || pk === SyntaxKind.ExportSpecifier;
}

for (const sf of sourceFiles) {
  const text = sf.getText();
  if (![...OLD_NAMES].some((n) => text.includes(n))) continue;

  const localNames = new Set<string>();

  // Collect names that need body-rewrite in this file:
  //   - own FunctionDeclaration (definition site)
  //   - bare named imports (no alias)
  for (const fn of sf.getFunctions()) {
    const n = fn.getName();
    if (n && OLD_NAMES.has(n)) localNames.add(n);
  }
  for (const imp of sf.getImportDeclarations()) {
    for (const spec of imp.getNamedImports()) {
      const n = spec.getName();
      if (OLD_NAMES.has(n) && !spec.getAliasNode()) localNames.add(n);
    }
  }

  let fileChanged = false;

  // Pass A: rewrite import specifiers (handles `pushTables` and `pushTables as foo`)
  for (const imp of sf.getImportDeclarations()) {
    for (const spec of imp.getNamedImports()) {
      const n = spec.getName();
      if (OLD_NAMES.has(n)) {
        spec.setName(RENAMES[n]);
        edits++;
        fileChanged = true;
      }
    }
  }

  // Pass B: rewrite re-export specifiers (e.g. stack/index.ts)
  for (const exp of sf.getExportDeclarations()) {
    for (const spec of exp.getNamedExports()) {
      const n = spec.getName();
      if (OLD_NAMES.has(n)) {
        spec.setName(RENAMES[n]);
        edits++;
        fileChanged = true;
      }
    }
  }

  // Pass C: rewrite body identifiers (own function name + bare-import usages)
  if (localNames.size > 0) {
    const ids = sf.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const id of ids) {
      if (id.wasForgotten()) continue;
      const t = id.getText();
      if (!localNames.has(t)) continue;
      if (isImportOrExportSpecifierLeaf(id)) continue;
      if (isPropertyAccessName(id)) continue;
      if (isPropertyKey(id)) continue;
      id.replaceWithText(RENAMES[t]);
      edits++;
      fileChanged = true;
    }
  }

  if (fileChanged) filesEdited.add(sf.getFilePath());
}

console.log(`[plan] ${edits} edits across ${filesEdited.size} files`);

const sortedFiles = [...filesEdited].sort();
for (const f of sortedFiles) {
  console.log(`  ${f.replace(`${PARENT_ROOT}/`, "")}`);
}

if (DRY_RUN) {
  console.log("[dry-run] no files written");
  process.exit(0);
}

await project.save();
console.log(`[done] ${edits} edits written to ${filesEdited.size} files`);
