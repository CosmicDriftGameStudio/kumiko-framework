#!/usr/bin/env bun
// Codemod pass-2: select/update/delete-chains with simple where(eq(...))
// → selectMany / updateMany / deleteMany helpers.
//
// Patterns covered:
//   - db.select().from(t).where(eq(t.col, v))                → selectMany(db, t, {col: v})
//   - db.select().from(t).where(eq(t.col, v)).limit(n)        → selectMany(db, t, {col: v}, {limit: n})
//   - db.update(t).set(values).where(eq(t.col, v))            → updateMany(db, t, values, {col: v})
//   - db.delete(t).where(eq(t.col, v))                        → deleteMany(db, t, {col: v})
//   - Plus and(eq, eq, ...) multi-key
//
// NICHT covered: .select({projection}), .orderBy(...), .innerJoin(...),
// .returning(...) — diese bleiben als hand-patches mit drizzle.

import { Project, SyntaxKind, type Node } from "ts-morph";

const APPLY = process.argv.includes("--apply");
const ROOTS = ["packages/bundled-features/src", "packages/framework/src"];

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
  skipAddingFilesFromTsConfig: true,
});
for (const root of ROOTS) project.addSourceFilesAtPaths([`${root}/**/*.ts`]);

let totalEdits = 0;
let filesTouched = 0;

function parseEqCall(n: Node): readonly [string, string] | null {
  if (n.getKind() !== SyntaxKind.CallExpression) return null;
  const call = n.asKindOrThrow(SyntaxKind.CallExpression);
  if (call.getExpression().getText() !== "eq") return null;
  const args = call.getArguments();
  if (args.length !== 2) return null;
  const colNode = args[0]!;
  let colName: string | null = null;
  if (colNode.getKind() === SyntaxKind.ElementAccessExpression) {
    const e = colNode.asKindOrThrow(SyntaxKind.ElementAccessExpression);
    const arg = e.getArgumentExpression();
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
      colName = arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
    }
  } else if (colNode.getKind() === SyntaxKind.PropertyAccessExpression) {
    colName = colNode.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
  }
  if (!colName) return null;
  return [colName, args[1]!.getText()];
}

function parseConds(n: Node): readonly (readonly [string, string])[] | null {
  if (n.getKind() === SyntaxKind.CallExpression) {
    const call = n.asKindOrThrow(SyntaxKind.CallExpression);
    if (call.getExpression().getText() === "and") {
      const conds: (readonly [string, string])[] = [];
      for (const a of call.getArguments()) {
        const eqr = parseEqCall(a);
        if (!eqr) return null;
        conds.push(eqr);
      }
      return conds.length > 0 ? conds : null;
    }
  }
  const eqr = parseEqCall(n);
  return eqr ? [eqr] : null;
}

function buildObj(conds: readonly (readonly [string, string])[]): string {
  if (conds.length === 1) {
    return `{ ${conds[0]![0]}: ${conds[0]![1]} }`;
  }
  return `{ ${conds.map(([k, v]) => (k === v ? k : `${k}: ${v}`)).join(", ")} }`;
}

// Walk chain back from .where() to find: dbExpr.select().from(table) etc.
// Returns { kind, dbExpr, table, valuesArg?, limitArg? } or null.
type ChainInfo =
  | { kind: "select"; dbText: string; table: string; limit?: string }
  | { kind: "update"; dbText: string; table: string; values: string }
  | { kind: "delete"; dbText: string; table: string };

function analyzeChain(whereCall: Node): { info: ChainInfo; replaceNode: Node } | null {
  // whereCall is PropertyAccessExpression `.where` invoked. Parent is CallExpression.
  const whereCallExpr = whereCall.getParent();
  if (!whereCallExpr || whereCallExpr.getKind() !== SyntaxKind.CallExpression) return null;
  const call = whereCallExpr.asKindOrThrow(SyntaxKind.CallExpression);
  // The thing before .where(): a CallExpression `.from(t)` or `.set(v)` or `delete(t)`
  const propAccess = call.getExpression();
  if (propAccess.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const prop = propAccess.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const lhs = prop.getExpression();
  if (lhs.getKind() !== SyntaxKind.CallExpression) return null;
  const lhsCall = lhs.asKindOrThrow(SyntaxKind.CallExpression);
  const lhsName = lhsCall.getExpression();
  if (lhsName.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const lhsProp = lhsName.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const op = lhsProp.getName(); // "from" | "set" | <other>

  // Determine the chain root (db expr) and table/values
  if (op === "from") {
    // chain: db.select().from(t).where(...)
    const fromArgs = lhsCall.getArguments();
    if (fromArgs.length !== 1) return null;
    const table = fromArgs[0]!.getText();
    // lhsProp.getExpression() should be: db.select() with NO args
    const selectCall = lhsProp.getExpression();
    if (selectCall.getKind() !== SyntaxKind.CallExpression) return null;
    const selectInvocation = selectCall.asKindOrThrow(SyntaxKind.CallExpression);
    if (selectInvocation.getArguments().length !== 0) return null; // has projection
    const selectProp = selectInvocation.getExpression();
    if (selectProp.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
    const sp = selectProp.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (sp.getName() !== "select") return null;
    const dbText = sp.getExpression().getText();
    // Now check if the WHOLE chain has .limit() chained after
    const fullChain = call;
    const parent = fullChain.getParent();
    let replaceNode: Node = fullChain;
    let limit: string | undefined;
    if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const parentProp = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
      const nextOp = parentProp.getName();
      if (nextOp === "limit") {
        const limitCall = parentProp.getParent();
        if (limitCall && limitCall.getKind() === SyntaxKind.CallExpression) {
          const lc = limitCall.asKindOrThrow(SyntaxKind.CallExpression);
          const limitArgs = lc.getArguments();
          if (limitArgs.length === 1) {
            limit = limitArgs[0]!.getText();
            replaceNode = lc;
            // Bail if .limit() is itself chained further (e.g. .orderBy)
            const limitParent = lc.getParent();
            if (limitParent && limitParent.getKind() === SyntaxKind.PropertyAccessExpression) {
              return null;
            }
          }
        }
      } else {
        // .orderBy, .for, .innerJoin, .leftJoin, .groupBy, .offset etc. — not supported by selectMany.
        return null;
      }
    }
    return { info: { kind: "select", dbText, table, limit }, replaceNode };
  }

  if (op === "set") {
    // chain: db.update(t).set(v).where(...)
    const setArgs = lhsCall.getArguments();
    if (setArgs.length !== 1) return null;
    const values = setArgs[0]!.getText();
    const updateCall = lhsProp.getExpression();
    if (updateCall.getKind() !== SyntaxKind.CallExpression) return null;
    const updateInvocation = updateCall.asKindOrThrow(SyntaxKind.CallExpression);
    const updateArgs = updateInvocation.getArguments();
    if (updateArgs.length !== 1) return null;
    const table = updateArgs[0]!.getText();
    const updateProp = updateInvocation.getExpression();
    if (updateProp.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
    const up = updateProp.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (up.getName() !== "update") return null;
    const dbText = up.getExpression().getText();
    // Skip if followed by .returning() — that's an UPDATE...RETURNING case;
    // hand-patch needed (updateMany returns rows but caller may expect specific shape)
    const parent = call.getParent();
    if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pn = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
      if (pn === "returning") return null; // hand-patch needed
    }
    return { info: { kind: "update", dbText, table, values }, replaceNode: call };
  }

  return null;
}

function tryDelete(whereCall: Node): { info: ChainInfo; replaceNode: Node } | null {
  // chain: db.delete(t).where(...)
  const whereCallExpr = whereCall.getParent();
  if (!whereCallExpr || whereCallExpr.getKind() !== SyntaxKind.CallExpression) return null;
  const call = whereCallExpr.asKindOrThrow(SyntaxKind.CallExpression);
  const propAccess = call.getExpression();
  if (propAccess.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const prop = propAccess.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const lhs = prop.getExpression();
  if (lhs.getKind() !== SyntaxKind.CallExpression) return null;
  const lhsCall = lhs.asKindOrThrow(SyntaxKind.CallExpression);
  const lhsName = lhsCall.getExpression();
  if (lhsName.getKind() !== SyntaxKind.PropertyAccessExpression) return null;
  const lhsProp = lhsName.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  if (lhsProp.getName() !== "delete") return null;
  const args = lhsCall.getArguments();
  if (args.length !== 1) return null;
  const table = args[0]!.getText();
  const dbText = lhsProp.getExpression().getText();
  return { info: { kind: "delete", dbText, table }, replaceNode: call };
}

const newHelperImports = new Set<string>();

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  if (filePath.includes("/dist/") || filePath.includes("/__tests__/") || filePath.includes(".test.")) continue;

  let edits = 0;
  const needsHelpers = new Set<string>();

  // Collect candidates with positions (start/end) cached upfront — applying
  // edits invalidates ts-morph nodes; positions are stable text-coords.
  const candidates: { start: number; end: number; newText: string }[] = [];
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const prop = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (prop.getName() !== "where") return;
    const whereArgs = call.getArguments();
    if (whereArgs.length !== 1) return;
    const conds = parseConds(whereArgs[0]!);
    if (!conds) return;

    const analysis = analyzeChain(prop) ?? tryDelete(prop);
    if (!analysis) return;

    const info = analysis.info;
    const condObj = buildObj(conds);
    let newText = "";
    if (info.kind === "select") {
      const optsPart = info.limit !== undefined ? `, { limit: ${info.limit} }` : "";
      newText = `selectMany(${info.dbText}, ${info.table}, ${condObj}${optsPart})`;
      needsHelpers.add("selectMany");
    } else if (info.kind === "update") {
      newText = `updateMany(${info.dbText}, ${info.table}, ${info.values}, ${condObj})`;
      needsHelpers.add("updateMany");
    } else if (info.kind === "delete") {
      newText = `deleteMany(${info.dbText}, ${info.table}, ${condObj})`;
      needsHelpers.add("deleteMany");
    }
    candidates.push({
      start: analysis.replaceNode.getStart(),
      end: analysis.replaceNode.getEnd(),
      newText,
    });
  });

  // Apply edits back-to-front so earlier positions remain valid.
  candidates.sort((a, b) => b.start - a.start);
  for (const c of candidates) {
    sourceFile.replaceText([c.start, c.end], c.newText);
    edits++;
  }

  if (edits > 0) {
    // Remove unused eq/and from drizzle-orm imports
    for (const imp of sourceFile.getImportDeclarations()) {
      if (imp.getModuleSpecifierValue() !== "drizzle-orm") continue;
      for (const ni of imp.getNamedImports()) {
        const name = ni.getName();
        if (name !== "eq" && name !== "and") continue;
        const refs = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).filter(
          (id) => id.getText() === name && id.getParent()?.getKind() !== SyntaxKind.ImportSpecifier,
        );
        if (refs.length === 0) ni.remove();
      }
      if (imp.getNamedImports().length === 0 && !imp.getDefaultImport()) imp.remove();
    }

    // Add helper imports to framework/db
    const existingHelperImport = sourceFile.getImportDeclaration(
      (imp) => imp.getModuleSpecifierValue() === "@cosmicdrift/kumiko-framework/db",
    );
    if (existingHelperImport) {
      const existing = new Set(existingHelperImport.getNamedImports().map((n) => n.getName()));
      const toAdd = [...needsHelpers].filter((h) => !existing.has(h));
      if (toAdd.length > 0) {
        existingHelperImport.addNamedImports(toAdd);
      }
    } else {
      sourceFile.addImportDeclaration({
        moduleSpecifier: "@cosmicdrift/kumiko-framework/db",
        namedImports: [...needsHelpers],
      });
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
