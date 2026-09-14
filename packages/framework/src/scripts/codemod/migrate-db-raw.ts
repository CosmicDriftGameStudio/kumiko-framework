#!/usr/bin/env bun
// migrate-db-raw — rewrites standalone bun-db helper calls that manually pass
// ctx.db.raw to their TenantDb method-form equivalent (db.global(table)... /
// db.selectMany|fetchOne|insertOne(...)) wherever the rewrite is provably
// safe, and reports every remaining ctx.db.raw-ish access for manual review.
//
// Usage:
//   bun scripts/codemod/migrate-db-raw.ts [--dry-run] [--global-tables a,b] <path...>

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Node, Project, type SourceFile, SyntaxKind, VariableDeclarationKind } from "ts-morph";

const DEFAULT_GLOBAL_TABLES: ReadonlySet<string> = new Set([
  "userTable",
  "globalFeatureStateTable",
]);
const PRUNABLE_FN_NAMES: ReadonlySet<string> = new Set(["selectMany", "fetchOne", "insertOne"]);
const OWN_TENANT_FN_NAMES: ReadonlySet<string> = new Set(["selectMany", "fetchOne", "insertOne"]);
const GLOBAL_TABLE_FN_NAMES: ReadonlySet<string> = new Set(["selectMany", "fetchOne"]);
const TENANT_ID_SOURCES: ReadonlySet<string> = new Set([
  "event.user.tenantId",
  "query.user.tenantId",
  "ctx.user.tenantId",
]);
const RAW_RECEIVER_IDENTIFIERS: ReadonlySet<string> = new Set([
  "db",
  "tdb",
  "scopedDb",
  "outsideTx",
]);
const MANUAL_TEXT_LIMIT = 100;

export type RewriteRule = "global-table" | "own-tenant";

export interface Rewrite {
  readonly file: string;
  readonly line: number;
  readonly rule: RewriteRule;
  readonly before: string;
  readonly after: string;
}

export interface ManualSite {
  readonly file: string;
  readonly line: number;
  readonly enclosing: string;
  readonly text: string;
}

export interface MigrateDbRawResult {
  readonly output: string;
  readonly rewrites: Rewrite[];
  readonly manual: ManualSite[];
}

function isRawOnCtxDb(argExpr: Node): boolean {
  return argExpr.getText() === "ctx.db.raw";
}

function enclosingFunctionScope(node: Node): Node {
  return (
    node.getFirstAncestor(
      (n) =>
        Node.isFunctionDeclaration(n) ||
        Node.isArrowFunction(n) ||
        Node.isFunctionExpression(n) ||
        Node.isMethodDeclaration(n),
    ) ?? node.getSourceFile()
  );
}

function isConstTenantIdBinding(scope: Node, varName: string): boolean {
  return scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration).some((decl) => {
    if (decl.getName() !== varName) return false;
    const statement = decl.getVariableStatement();
    if (!statement || statement.getDeclarationKind() !== VariableDeclarationKind.Const)
      return false;
    const initializer = decl.getInitializer();
    return initializer !== undefined && TENANT_ID_SOURCES.has(initializer.getText());
  });
}

function isValidOwnTenantIdValue(valueNode: Node): boolean {
  if (TENANT_ID_SOURCES.has(valueNode.getText())) return true;
  if (!Node.isIdentifier(valueNode)) return false;
  return isConstTenantIdBinding(enclosingFunctionScope(valueNode), valueNode.getText());
}

function objectHasValidOwnTenantId(obj: Node): boolean {
  if (!Node.isObjectLiteralExpression(obj)) return false;
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop) && prop.getName() === "tenantId") {
      const init = prop.getInitializer();
      return init !== undefined && isValidOwnTenantIdValue(init);
    }
    if (Node.isShorthandPropertyAssignment(prop) && prop.getName() === "tenantId") {
      return isConstTenantIdBinding(enclosingFunctionScope(prop), "tenantId");
    }
  }
  return false;
}

interface PendingRewrite {
  readonly callExpr: Node;
  readonly rule: RewriteRule;
  readonly before: string;
  readonly after: string;
  readonly line: number;
}

// The caller checks `args.length` immediately before every use — the index
// is always in bounds; this replaces a non-null assertion with an explicit
// invariant instead of silencing the compiler.
function nthArg(args: Node[], index: number): Node {
  const arg = args[index];
  if (!arg) throw new Error(`planRewrite: expected an argument at index ${index}`);
  return arg;
}

function planRewrite(
  callExpr: Node,
  globalTables: ReadonlySet<string>,
): PendingRewrite | undefined {
  if (!Node.isCallExpression(callExpr)) return undefined;
  const calleeExpr = callExpr.getExpression();
  if (!Node.isIdentifier(calleeExpr)) return undefined;
  const fnName = calleeExpr.getText();
  const args = callExpr.getArguments();
  if (args.length === 0 || !isRawOnCtxDb(nthArg(args, 0))) return undefined;

  const typeArgs = callExpr.getTypeArguments();
  const typeArgsText =
    typeArgs.length > 0 ? `<${typeArgs.map((t) => t.getText()).join(", ")}>` : "";

  if (GLOBAL_TABLE_FN_NAMES.has(fnName) && args.length >= 2) {
    const tableArg = nthArg(args, 1);
    if (Node.isIdentifier(tableArg) && globalTables.has(tableArg.getText())) {
      const rest = args.slice(2).map((a) => a.getText());
      const after = `ctx.db.global(${tableArg.getText()}).${fnName}${typeArgsText}(${rest.join(", ")})`;
      return {
        callExpr,
        rule: "global-table",
        before: callExpr.getText(),
        after,
        line: callExpr.getStartLineNumber(),
      };
    }
  }

  if (OWN_TENANT_FN_NAMES.has(fnName) && args.length >= 3) {
    const objArg = nthArg(args, 2);
    if (objectHasValidOwnTenantId(objArg)) {
      const rest = [nthArg(args, 1), objArg, ...args.slice(3)].map((a) => a.getText());
      const after = `ctx.db.${fnName}${typeArgsText}(${rest.join(", ")})`;
      return {
        callExpr,
        rule: "own-tenant",
        before: callExpr.getText(),
        after,
        line: callExpr.getStartLineNumber(),
      };
    }
  }

  return undefined;
}

function isTenantDbRawAccess(pae: Node): boolean {
  if (!Node.isPropertyAccessExpression(pae)) return false;
  if (pae.getName() !== "raw") return false;
  const receiver = pae.getExpression();
  if (receiver.getText().endsWith(".db")) return true;
  if (Node.isIdentifier(receiver) && RAW_RECEIVER_IDENTIFIERS.has(receiver.getText())) return true;
  if (
    Node.isCallExpression(receiver) &&
    receiver.getExpression().getText().startsWith("ctx.systemDb.")
  )
    return true;
  return false;
}

function enclosingName(node: Node): string {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      const name = current.getName();
      if (name) return name;
    }
    if (Node.isMethodDeclaration(current)) return current.getName();
    if (Node.isPropertyAssignment(current)) return current.getName();
    if (Node.isVariableDeclaration(current)) return current.getName();
    current = current.getParent();
  }
  return "<module>";
}

function truncate(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

function directArgumentCall(pae: Node): Node | undefined {
  const parent = pae.getParent();
  if (parent && Node.isCallExpression(parent) && parent.getArguments().some((a) => a === pae)) {
    return parent;
  }
  return undefined;
}

function collectManualSite(pae: Node, fileName: string): ManualSite {
  const reportNode = directArgumentCall(pae) ?? pae;
  return {
    file: fileName,
    line: reportNode.getStartLineNumber(),
    enclosing: enclosingName(pae),
    text: truncate(reportNode.getText(), MANUAL_TEXT_LIMIT),
  };
}

function isPropertyAccessName(id: Node): boolean {
  const parent = id.getParent();
  return Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id;
}

function pruneUnusedDbImports(sourceFile: SourceFile): void {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    for (const spec of [...importDecl.getNamedImports()]) {
      if (!PRUNABLE_FN_NAMES.has(spec.getName())) continue;
      const localName = spec.getAliasNode()?.getText() ?? spec.getName();
      const nameNode = spec.getAliasNode() ?? spec.getNameNode();
      const stillUsed = sourceFile
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .some((id) => id !== nameNode && id.getText() === localName && !isPropertyAccessName(id));
      if (!stillUsed) spec.remove();
    }
    if (
      importDecl.getNamedImports().length === 0 &&
      !importDecl.getDefaultImport() &&
      !importDecl.getNamespaceImport()
    ) {
      importDecl.remove();
    }
  }
}

export function migrateDbRawSource(
  source: string,
  fileName: string,
  opts: { globalTables: ReadonlySet<string> },
): MigrateDbRawResult {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sourceFile = project.createSourceFile(fileName, source);

  const pending: PendingRewrite[] = [];
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const plan = planRewrite(callExpr, opts.globalTables);
    if (plan) pending.push(plan);
  }

  const rewrites: Rewrite[] = [];
  for (const plan of pending) {
    if (plan.callExpr.wasForgotten()) continue;
    plan.callExpr.replaceWithText(plan.after);
    rewrites.push({
      file: fileName,
      line: plan.line,
      rule: plan.rule,
      before: plan.before,
      after: plan.after,
    });
  }

  pruneUnusedDbImports(sourceFile);

  const manual: ManualSite[] = [];
  for (const pae of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (isTenantDbRawAccess(pae)) manual.push(collectManualSite(pae, fileName));
  }

  return { output: sourceFile.getFullText(), rewrites, manual };
}

class CliError extends Error {}

interface CliOptions {
  readonly dryRun: boolean;
  readonly globalTables: ReadonlySet<string>;
  readonly paths: string[];
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let globalTables: ReadonlySet<string> = DEFAULT_GLOBAL_TABLES;
  const paths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) break;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--global-tables") {
      const value = argv[++i];
      if (!value) throw new CliError("--global-tables requires a comma-separated value");
      globalTables = new Set(
        value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
      continue;
    }
    if (arg.startsWith("--")) throw new CliError(`unknown flag: ${arg}`);
    paths.push(arg);
  }

  if (paths.length === 0) throw new CliError("at least one path is required");
  return { dryRun, globalTables, paths };
}

function isMigratableFile(name: string): boolean {
  if (!/\.(ts|tsx)$/.test(name)) return false;
  if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return false;
  return true;
}

function walkDir(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkDir(full, out);
      continue;
    }
    if (isMigratableFile(name)) out.push(full);
  }
}

function collectFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    const stat = statSync(abs);
    if (stat.isDirectory()) walkDir(abs, files);
    else if (isMigratableFile(abs)) files.push(abs);
  }
  return files;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`[migrate-db-raw] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const files = collectFiles(options.paths);
  const allRewrites: Rewrite[] = [];
  const allManual: ManualSite[] = [];
  let filesChanged = 0;

  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = migrateDbRawSource(before, file, { globalTables: options.globalTables });
    allRewrites.push(...result.rewrites);
    allManual.push(...result.manual);

    if (result.rewrites.length === 0) continue;
    filesChanged += 1;

    if (options.dryRun) {
      console.log(`\n=== ${file} (${result.rewrites.length} rewrite(s)) ===`);
      for (const r of result.rewrites) {
        console.log(`${file}:${r.line} [${r.rule}]`);
        console.log(`- ${r.before}`);
        console.log(`+ ${r.after}`);
      }
    } else {
      writeFileSync(file, result.output);
    }
  }

  const globalCount = allRewrites.filter((r) => r.rule === "global-table").length;
  const ownTenantCount = allRewrites.filter((r) => r.rule === "own-tenant").length;
  console.log(
    `\n[migrate-db-raw] ${options.dryRun ? "would change" : "changed"} ${filesChanged} file(s); ` +
      `rewrites: global-table=${globalCount}, own-tenant=${ownTenantCount}`,
  );

  if (allManual.length > 0) {
    console.log(`\n[migrate-db-raw] manual review needed (${allManual.length}):`);
    for (const m of allManual) {
      console.log(`${m.file}:${m.line}  ${m.enclosing}  ${m.text}`);
    }
  }

  process.exit(0);
}

if (import.meta.main) {
  await main();
}
