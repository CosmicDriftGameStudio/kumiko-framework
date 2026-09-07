#!/usr/bin/env bun
// `UnprocessableOpts.details` was tightened (fw#2460) to `& { readonly reason?:
// never }` — `reason` is owned exclusively by the ctor's first positional
// argument, which already folds it into `details` internally
// (`{ ...opts?.details, reason }`). Any consumer that ALSO puts `reason`
// inside its `details` object literal now fails with TS2322. This codemod
// removes that redundant `reason` property; the value is never lost, it was
// already duplicated from the positional argument.
//
// Usage: bun scripts/codemod/unprocessable-error-details-reason.ts <targetDir> [--dry-run]

import { type Dirent, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  type Identifier,
  Node,
  type ObjectLiteralExpression,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

const EXCLUDE_DIRS = new Set(["node_modules", "dist", "build"]);
const KUMIKO_MODULE_RE = /^@cosmicdrift\/kumiko-/;

function findTargetFiles(rootDir: string): string[] {
  // Walk the tree and skip excluded dirs while descending — filtering the
  // absolute path after a full scan silently no-ops when the repo root
  // itself contains "/build/" or "/node_modules/" (fw#2289).
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // skip: unreadable directory during walk — treat as empty.
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

type ImportedBinding = { readonly importedName: string; readonly moduleSpecifier: string };

/** Local-name -> where it's imported from, for every named value import in the file. */
function collectImportedNames(sourceFile: SourceFile): Map<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
    const moduleSpecifier = imp.getModuleSpecifierValue();
    for (const spec of imp.getNamedImports()) {
      if (spec.isTypeOnly()) continue;
      const importedName = spec.getName();
      const localName = spec.getAliasNode()?.getText() ?? importedName;
      bindings.set(localName, { importedName, moduleSpecifier });
    }
  }
  return bindings;
}

type DetailsResolution =
  | { readonly kind: "object-literal"; readonly literal: ObjectLiteralExpression }
  | { readonly kind: "unresolvable"; readonly note: string }
  | { readonly kind: "absent" };

/** Resolves `opts.details` to a statically-inspectable object literal, or explains why it can't be. */
function resolveDetailsProperty(optsLiteral: ObjectLiteralExpression): DetailsResolution {
  const prop = optsLiteral.getProperty("details");
  if (!prop) return { kind: "absent" };

  if (Node.isShorthandPropertyAssignment(prop)) {
    return { kind: "unresolvable", note: "details is a shorthand property (a variable)" };
  }
  if (!Node.isPropertyAssignment(prop)) {
    return { kind: "unresolvable", note: "details is not a plain property assignment" };
  }
  if (Node.isComputedPropertyName(prop.getNameNode())) {
    return { kind: "unresolvable", note: "details key is computed" };
  }
  const init = prop.getInitializer();
  if (!init) return { kind: "unresolvable", note: "details has no initializer" };
  if (Node.isObjectLiteralExpression(init)) return { kind: "object-literal", literal: init };

  const note = Node.isIdentifier(init)
    ? `details is a variable ("${init.getText()}")`
    : Node.isCallExpression(init)
      ? "details is a call-expression result"
      : Node.isConditionalExpression(init)
        ? "details is a conditional expression"
        : `details is not a statically-analyzable object literal (${init.getKindName()})`;
  return { kind: "unresolvable", note };
}

/** True if removing this shorthand-bound identifier would leave its declaration with no other use. */
function wouldLeaveUnusedVariable(nameNode: Identifier): boolean {
  try {
    const refs = nameNode.findReferencesAsNodes();
    const others = refs.filter((r) => r !== nameNode);
    return others.length === 0;
  } catch {
    // Can't verify — treat as unsafe rather than guess.
    return true;
  }
}

type RemovalResult =
  | { readonly kind: "removed" }
  | { readonly kind: "absent" }
  | { readonly kind: "skip"; readonly note: string };

/** Removes the `reason` property from a `details` object literal, in place. */
function removeReasonProperty(detailsLiteral: ObjectLiteralExpression): RemovalResult {
  const properties = detailsLiteral.getProperties();
  if (properties.some((p) => Node.isSpreadAssignment(p))) {
    return {
      kind: "skip",
      note: "details object literal contains a spread — not statically decidable",
    };
  }

  for (const prop of properties) {
    if (Node.isPropertyAssignment(prop)) {
      const nameNode = prop.getNameNode();
      if (Node.isComputedPropertyName(nameNode)) {
        const expr = nameNode.getExpression();
        if (Node.isStringLiteral(expr) && expr.getLiteralText() === "reason") {
          return { kind: "skip", note: "reason key is computed — not safe to remove mechanically" };
        }
        continue;
      }
      const propName = Node.isIdentifier(nameNode)
        ? nameNode.getText()
        : Node.isStringLiteral(nameNode)
          ? nameNode.getLiteralText()
          : undefined;
      if (propName === "reason") {
        prop.remove();
        return { kind: "removed" };
      }
      continue;
    }
    if (Node.isShorthandPropertyAssignment(prop) && prop.getName() === "reason") {
      if (wouldLeaveUnusedVariable(prop.getNameNode())) {
        return {
          kind: "skip",
          note: "reason is a shorthand property; removing it would leave the bound variable unused",
        };
      }
      prop.remove();
      return { kind: "removed" };
    }
  }
  return { kind: "absent" };
}

type CallOutcome = "changed" | "skipped" | "not-a-match";

function processNewExpression(args: readonly Node[], report: (note: string) => void): CallOutcome {
  const optsArg = args[1];
  if (!optsArg) return "not-a-match";

  if (!Node.isObjectLiteralExpression(optsArg)) {
    report(
      "second argument (opts) is not a statically-analyzable object literal — cannot verify details.reason",
    );
    return "skipped";
  }

  const detailsRes = resolveDetailsProperty(optsArg);
  if (detailsRes.kind === "absent") return "not-a-match";
  if (detailsRes.kind === "unresolvable") {
    report(detailsRes.note);
    return "skipped";
  }

  const removal = removeReasonProperty(detailsRes.literal);
  if (removal.kind === "absent") return "not-a-match";
  if (removal.kind === "skip") {
    report(removal.note);
    return "skipped";
  }
  return "changed";
}

type SkipEntry = { readonly file: string; readonly line: number; readonly note: string };

/** Migrates one file in place. Returns how many `reason` properties were removed. */
function migrateFile(sourceFile: SourceFile, skips: SkipEntry[]): number {
  const importedNames = collectImportedNames(sourceFile);
  let removedCount = 0;

  for (const newExpr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const callee = newExpr.getExpression();
    if (!Node.isIdentifier(callee)) continue;
    const localName = callee.getText();

    const binding = importedNames.get(localName);
    const isFrameworkUnprocessableError = binding?.importedName === "UnprocessableError";

    if (!isFrameworkUnprocessableError) {
      if (localName !== "UnprocessableError") continue;
      const note = binding
        ? `UnprocessableError is imported from "${binding.moduleSpecifier}", not a @cosmicdrift/kumiko-* package`
        : "UnprocessableError has no @cosmicdrift/kumiko-* import in this file (likely a locally defined class)";
      skips.push({ file: sourceFile.getFilePath(), line: newExpr.getStartLineNumber(), note });
      continue;
    }
    if (!KUMIKO_MODULE_RE.test(binding.moduleSpecifier)) {
      skips.push({
        file: sourceFile.getFilePath(),
        line: newExpr.getStartLineNumber(),
        note: `UnprocessableError is imported from "${binding.moduleSpecifier}", not a @cosmicdrift/kumiko-* package`,
      });
      continue;
    }

    const outcome = processNewExpression(newExpr.getArguments(), (note) => {
      skips.push({ file: sourceFile.getFilePath(), line: newExpr.getStartLineNumber(), note });
    });
    if (outcome === "changed") removedCount++;
  }

  return removedCount;
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
  let removedTotal = 0;
  const skips: SkipEntry[] = [];

  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    const removed = migrateFile(sourceFile, skips);
    if (removed === 0) continue;

    touchedFiles++;
    removedTotal += removed;
    if (!dryRun) sourceFile.saveSync();
  }

  console.log(`\nScanned ${files.length} files under ${rootDir}${dryRun ? " (dry-run)" : ""}.`);
  console.log(
    `Touched ${touchedFiles} files, removed ${removedTotal} redundant "reason" propert(y/ies).`,
  );
  console.log(`Skipped ${skips.length} site(s):`);
  for (const s of skips) {
    console.log(`  ${relative(rootDir, s.file)}:${s.line} — ${s.note}`);
  }
  console.log();
}

await main();
