#!/usr/bin/env bun
// migrate-open-to-all: rewrites deprecated `openToAll: true` to `{ reason }` in test files, and reports remaining non-test sites for a human to fix (see #2858). Usage: bun scripts/migrate-open-to-all.ts [--dry-run] [--test-reason "<text>"] <path...>

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Node,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  Project,
  SyntaxKind,
} from "ts-morph";

const DEFAULT_TEST_REASON = "test handler callable by any signed-in test user";

export interface Rewrite {
  readonly file: string;
  readonly line: number;
  readonly before: string;
  readonly after: string;
}

export interface ManualSite {
  readonly file: string;
  readonly line: number;
  readonly handlerName?: string;
  readonly description?: string;
}

export interface MigrateOpenToAllResult {
  readonly output: string;
  readonly rewrites: Rewrite[];
  readonly manual: ManualSite[];
}

export interface MigrateOpenToAllOptions {
  readonly testReason: string;
}

function isTestFile(fileName: string): boolean {
  return /(^|\/)__tests__\//.test(fileName) || /\.test\.(ts|tsx)$/.test(fileName);
}

function isOpenToAllTrueAssignment(node: Node): node is PropertyAssignment {
  if (!Node.isPropertyAssignment(node)) return false;
  if (node.getName() !== "openToAll") return false;
  return node.getInitializer()?.getKind() === SyntaxKind.TrueKeyword;
}

function readStringLiteralProperty(obj: ObjectLiteralExpression, name: string): string | undefined {
  const prop = obj.getProperty(name);
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined;
  const init = prop.getInitializer();
  return init && Node.isStringLiteral(init) ? init.getLiteralValue() : undefined;
}

function enclosingObjectLiterals(node: Node): ObjectLiteralExpression[] {
  const result: ObjectLiteralExpression[] = [];
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isObjectLiteralExpression(current)) result.push(current);
    current = current.getParent();
  }
  return result;
}

// Best-effort human-triage hint (not the rewrite's source of truth): derive a handler name/description from the enclosing object literal, or the enclosing call's first string-literal argument for the positional form.
function deriveHandlerContext(assignment: PropertyAssignment): {
  readonly handlerName?: string;
  readonly description?: string;
} {
  let handlerName: string | undefined;
  let description: string | undefined;
  for (const obj of enclosingObjectLiterals(assignment)) {
    if (handlerName === undefined) handlerName = readStringLiteralProperty(obj, "name");
    if (description === undefined) description = readStringLiteralProperty(obj, "description");
    if (handlerName !== undefined && description !== undefined) break;
  }
  if (handlerName === undefined) {
    const call = assignment.getFirstAncestorByKind(SyntaxKind.CallExpression);
    const firstArg = call?.getArguments()[0];
    if (firstArg && Node.isStringLiteral(firstArg)) handlerName = firstArg.getLiteralValue();
  }
  return {
    ...(handlerName !== undefined && { handlerName }),
    ...(description !== undefined && { description }),
  };
}

export function migrateOpenToAllSource(
  source: string,
  fileName: string,
  opts: MigrateOpenToAllOptions,
): MigrateOpenToAllResult {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sourceFile = project.createSourceFile(fileName, source);
  const testFile = isTestFile(fileName);

  const targets = sourceFile
    .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
    .filter(isOpenToAllTrueAssignment);

  const rewrites: Rewrite[] = [];
  const manual: ManualSite[] = [];

  for (const assignment of targets) {
    if (assignment.wasForgotten()) continue;
    const line = assignment.getStartLineNumber();

    if (testFile) {
      const before = assignment.getText();
      const after = `openToAll: { reason: ${JSON.stringify(opts.testReason)} }`;
      assignment.replaceWithText(after);
      rewrites.push({ file: fileName, line, before, after });
      continue;
    }

    manual.push({ file: fileName, line, ...deriveHandlerContext(assignment) });
  }

  return { output: sourceFile.getFullText(), rewrites, manual };
}

class CliError extends Error {}

interface CliOptions {
  readonly dryRun: boolean;
  readonly testReason: string;
  readonly paths: string[];
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let testReason = DEFAULT_TEST_REASON;
  const paths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--test-reason") {
      const value = argv[++i];
      if (!value) throw new CliError("--test-reason requires a value");
      testReason = value;
      continue;
    }
    if (arg.startsWith("--")) throw new CliError(`unknown flag: ${arg}`);
    paths.push(arg);
  }

  if (paths.length === 0) throw new CliError("at least one path is required");
  return { dryRun, testReason, paths };
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
      console.error(`[migrate-open-to-all] ${err.message}`);
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
    if (!before.includes("openToAll")) continue;
    const result = migrateOpenToAllSource(before, file, { testReason: options.testReason });
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
    `\n[migrate-open-to-all] ${options.dryRun ? "would change" : "changed"} ${filesChanged} file(s); ` +
      `rewrites: ${totalRewrites}`,
  );

  if (allManual.length > 0) {
    console.log(`\n[migrate-open-to-all] manual review needed (${allManual.length}):`);
    for (const m of allManual) {
      console.log(
        `${m.file}:${m.line}  ${m.handlerName ?? "<unknown>"}  ${m.description ?? "<no description>"}`,
      );
    }
  }

  process.exit(0);
}

if (import.meta.main) {
  await main();
}
