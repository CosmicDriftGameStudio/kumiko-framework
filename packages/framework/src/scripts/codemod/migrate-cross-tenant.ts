#!/usr/bin/env bun
// migrate-cross-tenant — rewrites `crossTenant: true` on entity-convention
// handlers to `escapeHatch: { reason }` where the handler name and verb can
// be derived from the call, and reports every other site for review (fw#2915).
//
// Usage:
//   bun scripts/codemod/migrate-cross-tenant.ts [--dry-run] <path...>

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  Project,
  type PropertyAssignment,
  SyntaxKind,
} from "ts-morph";

export interface Rewrite {
  readonly file: string;
  readonly line: number;
  readonly before: string;
  readonly after: string;
}

export interface ManualSite {
  readonly file: string;
  readonly line: number;
  readonly why: string;
  readonly handlerName?: string;
}

export interface MigrateCrossTenantResult {
  readonly output: string;
  readonly rewrites: Rewrite[];
  readonly manual: ManualSite[];
}

const VERB_IN_NAME_CALLEES: Record<string, string> = {
  defineEntityCreateHandler: "create",
  defineEntityUpdateHandler: "update",
  defineEntityDeleteHandler: "delete",
  defineEntityRestoreHandler: "restore",
  defineEntityListHandler: "list",
  defineEntityDetailHandler: "detail",
};

const VERB_IN_ARG_CALLEES = new Set(["defineEntityWriteHandler", "defineEntityQueryHandler"]);

const READ_VERBS = new Set(["list", "detail"]);

function isCrossTenantAssignment(node: Node): node is PropertyAssignment {
  return Node.isPropertyAssignment(node) && node.getName() === "crossTenant";
}

function getCalleeName(call: CallExpression): string | undefined {
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  return undefined;
}

function hasEscapeHatchProperty(obj: ObjectLiteralExpression): boolean {
  return obj.getProperty("escapeHatch") !== undefined;
}

interface AutoRewriteTarget {
  readonly handlerName: string;
  readonly entityName: string;
  readonly verb: string;
}

function deriveAutoRewriteTarget(
  objectLiteral: ObjectLiteralExpression,
): AutoRewriteTarget | undefined {
  const call = objectLiteral.getParentIfKind(SyntaxKind.CallExpression);
  if (!call) return undefined;
  if (!call.getArguments().includes(objectLiteral)) return undefined;

  const calleeName = getCalleeName(call);
  if (!calleeName) return undefined;

  const firstArg = call.getArguments()[0];
  if (!firstArg || !Node.isStringLiteral(firstArg)) return undefined;
  const firstArgValue = firstArg.getLiteralValue();

  const verbFromName = VERB_IN_NAME_CALLEES[calleeName];
  if (verbFromName) {
    return {
      handlerName: `${firstArgValue}:${verbFromName}`,
      entityName: firstArgValue,
      verb: verbFromName,
    };
  }

  if (VERB_IN_ARG_CALLEES.has(calleeName)) {
    const sep = firstArgValue.indexOf(":");
    if (sep === -1) return undefined;
    const entityName = firstArgValue.slice(0, sep);
    const verb = firstArgValue.slice(sep + 1);
    if (!entityName || !verb) return undefined;
    return { handlerName: firstArgValue, entityName, verb };
  }

  return undefined;
}

function deriveEntityCrudContext(objectLiteral: ObjectLiteralExpression): string | undefined {
  const verbGroupAssignment = objectLiteral.getParent();
  if (!Node.isPropertyAssignment(verbGroupAssignment)) return undefined;
  const verbGroup = verbGroupAssignment.getName();
  if (verbGroup !== "write" && verbGroup !== "read") return undefined;

  const optionsObject = verbGroupAssignment.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
  const call = optionsObject?.getParentIfKind(SyntaxKind.CallExpression);
  if (!call || !optionsObject || !call.getArguments().includes(optionsObject)) return undefined;

  const calleeName = getCalleeName(call);
  if (calleeName !== "registerEntityCrud" && calleeName !== "crud") return undefined;

  const args = call.getArguments();
  const entityArg = calleeName === "crud" ? args[0] : args[1];
  const entityName =
    entityArg && Node.isStringLiteral(entityArg) ? entityArg.getLiteralValue() : undefined;
  return `under ${calleeName}(${entityName ? `"${entityName}", ` : ""}...) → ${verbGroup}: multiple verbs share this crossTenant — set escapeHatch per verb manually, one reason each`;
}

function classifyManualReason(objectLiteral: ObjectLiteralExpression): string {
  const entityCrudWhy = deriveEntityCrudContext(objectLiteral);
  if (entityCrudWhy) return entityCrudWhy;

  const call = objectLiteral.getParentIfKind(SyntaxKind.CallExpression);
  if (!call?.getArguments().includes(objectLiteral)) {
    return "crossTenant is not set directly in a handler call (e.g. a spread/shared object) — give each consuming handler its own escapeHatch reason";
  }

  const calleeName = getCalleeName(call);
  if (!calleeName || (!VERB_IN_NAME_CALLEES[calleeName] && !VERB_IN_ARG_CALLEES.has(calleeName))) {
    return `call \`${calleeName ?? "<unknown>"}\` is not a recognized entity-convention handler factory — add escapeHatch manually`;
  }

  return "handler name/verb could not be derived from the call's first argument — add escapeHatch manually";
}

function deriveBestEffortHandlerName(assignment: PropertyAssignment): string | undefined {
  const call = assignment.getFirstAncestorByKind(SyntaxKind.CallExpression);
  const firstArg = call?.getArguments()[0];
  return firstArg && Node.isStringLiteral(firstArg) ? firstArg.getLiteralValue() : undefined;
}

function buildEscapeHatchReason(target: AutoRewriteTarget): string {
  const verbKind = READ_VERBS.has(target.verb) ? "reads" : "writes";
  return `${target.handlerName} ${verbKind} ${target.entityName} rows across every tenant (migrated from crossTenant: true; state the operator use case here)`;
}

export function migrateCrossTenantSource(
  source: string,
  fileName: string,
): MigrateCrossTenantResult {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sourceFile = project.createSourceFile(fileName, source);

  const targets = sourceFile
    .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
    .filter(isCrossTenantAssignment);

  const rewrites: Rewrite[] = [];
  const manual: ManualSite[] = [];

  for (const assignment of targets) {
    if (assignment.wasForgotten()) continue;
    const line = assignment.getStartLineNumber();
    const init = assignment.getInitializer();

    if (init?.getKind() === SyntaxKind.FalseKeyword) continue;

    if (init?.getKind() !== SyntaxKind.TrueKeyword) {
      manual.push({
        file: fileName,
        line,
        why: `crossTenant is not a literal boolean (\`${init?.getText() ?? "<missing>"}\`) — replace manually with escapeHatch: { reason }`,
        ...(deriveBestEffortHandlerName(assignment) !== undefined && {
          handlerName: deriveBestEffortHandlerName(assignment),
        }),
      });
      continue;
    }

    const objectLiteral = assignment.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
    if (!objectLiteral) continue;

    if (hasEscapeHatchProperty(objectLiteral)) {
      manual.push({
        file: fileName,
        line,
        why: "this object already declares escapeHatch — merge the two manually and remove crossTenant",
        ...(deriveBestEffortHandlerName(assignment) !== undefined && {
          handlerName: deriveBestEffortHandlerName(assignment),
        }),
      });
      continue;
    }

    const target = deriveAutoRewriteTarget(objectLiteral);
    if (!target) {
      manual.push({
        file: fileName,
        line,
        why: classifyManualReason(objectLiteral),
        ...(deriveBestEffortHandlerName(assignment) !== undefined && {
          handlerName: deriveBestEffortHandlerName(assignment),
        }),
      });
      continue;
    }

    const before = assignment.getText();
    const after = `escapeHatch: { reason: ${JSON.stringify(buildEscapeHatchReason(target))} }`;
    assignment.replaceWithText(after);
    rewrites.push({ file: fileName, line, before, after });
  }

  return { output: sourceFile.getFullText(), rewrites, manual };
}

class CliError extends Error {}

interface CliOptions {
  readonly dryRun: boolean;
  readonly paths: string[];
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  const paths: string[] = [];

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--")) throw new CliError(`unknown flag: ${arg}`);
    paths.push(arg);
  }

  if (paths.length === 0) throw new CliError("at least one path is required");
  return { dryRun, paths };
}

function isMigratableFile(name: string): boolean {
  return /\.(ts|tsx)$/.test(name);
}

function walkDir(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
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
      console.error(`[migrate-cross-tenant] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const files = collectFiles(options.paths);
  const allManual: ManualSite[] = [];
  let filesChanged = 0;
  let totalRewrites = 0;

  for (const file of files) {
    const before = readFileSync(file, "utf8");
    if (!before.includes("crossTenant")) continue;
    const result = migrateCrossTenantSource(before, file);
    allManual.push(...result.manual);

    if (result.rewrites.length === 0) continue;
    filesChanged += 1;
    totalRewrites += result.rewrites.length;

    if (options.dryRun) {
      console.log(`\n=== ${file} (${result.rewrites.length} rewrite(s)) ===`);
      for (const r of result.rewrites) {
        console.log(`${file}:${r.line}`);
        console.log(`- ${r.before}`);
        console.log(`+ ${r.after}`);
      }
    } else {
      writeFileSync(file, result.output);
    }
  }

  console.log(
    `\n[migrate-cross-tenant] ${options.dryRun ? "would change" : "changed"} ${filesChanged} file(s); ` +
      `rewrites: ${totalRewrites}`,
  );

  if (allManual.length > 0) {
    console.log(`\n[migrate-cross-tenant] manual review needed (${allManual.length}):`);
    for (const m of allManual) {
      console.log(`${m.file}:${m.line}  ${m.handlerName ?? "<unknown>"}  ${m.why}`);
    }
  }

  process.exit(0);
}

if (import.meta.main) {
  await main();
}
