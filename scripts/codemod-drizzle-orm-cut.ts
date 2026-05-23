#!/usr/bin/env bun
// Codemod: ersetzt drizzle-orm `eq()`/`and(eq(...), eq(...))` Patterns
// in fetchOne-calls durch object-where syntax. Plus entfernt `eq, and`
// imports wenn sie nach dem Edit nicht mehr genutzt werden.
//
// Coverage: trivial fetchOne-Pattern (`fetchOne(db, t, eq(t.col, v))`
// oder `fetchOne(db, t, eq(...), eq(...))` oder `fetchOne(db, t, and(eq..., eq...))`).
// Komplexere Stellen (select-chains, raw sql) werden NICHT angepackt.
//
// Run:
//   bun scripts/codemod-drizzle-orm-cut.ts                  # dry-run
//   bun scripts/codemod-drizzle-orm-cut.ts --apply          # commit edits

import { Project, SyntaxKind, type Node } from "ts-morph";

const APPLY = process.argv.includes("--apply");
const ROOTS = [
  "packages/bundled-features/src",
  "packages/framework/src",
];

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
  skipAddingFilesFromTsConfig: true,
});
for (const root of ROOTS) project.addSourceFilesAtPaths([`${root}/**/*.ts`]);

let totalEdits = 0;
let filesTouched = 0;

// Returns array of [column-name, value-expression] if the node is `eq(t["x"], v)`
// or `eq(t.x, v)`. Returns null otherwise.
function parseEqCall(n: Node): readonly [string, string] | null {
  if (n.getKind() !== SyntaxKind.CallExpression) return null;
  const call = n.asKindOrThrow(SyntaxKind.CallExpression);
  const expr = call.getExpression();
  if (expr.getText() !== "eq") return null;
  const args = call.getArguments();
  if (args.length !== 2) return null;
  const colNode = args[0]!;
  const valNode = args[1]!;
  let colName: string | null = null;
  if (colNode.getKind() === SyntaxKind.ElementAccessExpression) {
    const e = colNode.asKindOrThrow(SyntaxKind.ElementAccessExpression);
    const arg = e.getArgumentExpression();
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
      colName = arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
    }
  } else if (colNode.getKind() === SyntaxKind.PropertyAccessExpression) {
    const p = colNode.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    colName = p.getName();
  }
  if (!colName) return null;
  return [colName, valNode.getText()];
}

// Returns array of conditions if node is `and(eq(...), eq(...))`
function parseAndOfEqs(n: Node): readonly (readonly [string, string])[] | null {
  if (n.getKind() !== SyntaxKind.CallExpression) return null;
  const call = n.asKindOrThrow(SyntaxKind.CallExpression);
  if (call.getExpression().getText() !== "and") return null;
  const conds: (readonly [string, string])[] = [];
  for (const arg of call.getArguments()) {
    const parsed = parseEqCall(arg);
    if (!parsed) return null;
    conds.push(parsed);
  }
  return conds.length > 0 ? conds : null;
}

function buildObjectWhere(conds: readonly (readonly [string, string])[]): string {
  if (conds.length === 1) {
    return `{ ${conds[0]![0]}: ${conds[0]![1]} }`;
  }
  const parts = conds.map(([k, v]) => (k === v ? k : `${k}: ${v}`));
  return `{ ${parts.join(", ")} }`;
}

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  if (filePath.includes("/dist/") || filePath.includes("/__tests__/") || filePath.includes(".test.")) continue;

  let edits = 0;

  // Find all fetchOne(db, table, ...) calls
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    if (call.getExpression().getText() !== "fetchOne") return;
    const args = call.getArguments();
    if (args.length < 3) return;
    const condArgs = args.slice(2);

    // Try parse: all-eq OR single-and-of-eqs
    let conds: readonly (readonly [string, string])[] | null = null;
    if (condArgs.length === 1) {
      const andResult = parseAndOfEqs(condArgs[0]!);
      if (andResult) {
        conds = andResult;
      } else {
        const eqResult = parseEqCall(condArgs[0]!);
        if (eqResult) conds = [eqResult];
      }
    } else {
      // multiple args: all must be eq()
      const parsed: (readonly [string, string])[] = [];
      let allEq = true;
      for (const a of condArgs) {
        const eqResult = parseEqCall(a);
        if (!eqResult) {
          allEq = false;
          break;
        }
        parsed.push(eqResult);
      }
      if (allEq && parsed.length > 0) conds = parsed;
    }

    if (!conds) return;

    const objWhere = buildObjectWhere(conds);
    // Replace all cond-args with the object
    const firstStart = condArgs[0]!.getStart();
    const lastEnd = condArgs[condArgs.length - 1]!.getEnd();
    const originalText = sourceFile.getFullText().slice(firstStart, lastEnd);
    sourceFile.replaceText([firstStart, lastEnd], objWhere);
    edits++;
  });

  if (edits > 0) {
    // Re-scan for imports — remove `eq`/`and` from drizzle-orm imports if unused
    for (const imp of sourceFile.getImportDeclarations()) {
      if (imp.getModuleSpecifierValue() !== "drizzle-orm") continue;
      const named = imp.getNamedImports();
      const toRemove: string[] = [];
      for (const ni of named) {
        const name = ni.getName();
        if (name !== "eq" && name !== "and") continue;
        // count usages outside this import
        const refs = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).filter(
          (id) => id.getText() === name && id.getParent()?.getKind() !== SyntaxKind.ImportSpecifier,
        );
        if (refs.length === 0) toRemove.push(name);
      }
      for (const name of toRemove) {
        const ni = imp.getNamedImports().find((n) => n.getName() === name);
        if (ni) ni.remove();
      }
      // remove import-statement if no named imports left + no default
      if (imp.getNamedImports().length === 0 && !imp.getDefaultImport()) {
        imp.remove();
      }
    }
    totalEdits += edits;
    filesTouched++;
    console.log(`${filePath.replace(process.cwd() + "/", "")}: ${edits} edit(s)`);
  }
}

console.log("");
console.log(`Total: ${totalEdits} edits in ${filesTouched} files.`);
if (APPLY) {
  await project.save();
  console.log("Saved.");
} else {
  console.log("Dry-run (use --apply to write).");
}
