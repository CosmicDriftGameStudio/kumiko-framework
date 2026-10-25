#!/usr/bin/env bun
/**
 * Call-Graph Analysis — finds thin wrappers and convergence hotspots.
 *
 *   bun scripts/call-graph-analysis.ts                        # framework/packages only
 *   bun scripts/call-graph-analysis.ts --all                  # all repos in the workspace
 *   bun scripts/call-graph-analysis.ts --hotspots             # convergence only
 *   bun scripts/call-graph-analysis.ts --wrappers             # thin wrappers only
 *   bun scripts/call-graph-analysis.ts --top 20               # top-N hotspots
 */
// @ts-nocheck: Bun script, not part of the tsc graph
import { join, relative } from "node:path";
import {
  Project,
  SyntaxKind,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type MethodDeclaration,
  type PropertyAssignment,
  type VariableDeclaration,
} from "ts-morph";

// ── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const SHOW_HOTSPOTS = args.includes("--hotspots") || !args.includes("--wrappers");
const SHOW_WRAPPERS = args.includes("--wrappers") || !args.includes("--hotspots");
const TOP_N = Number(
  args.find((a) => a.startsWith("--top="))?.split("=")[1] ??
  args[args.indexOf("--top") + 1] ??
  "15"
);
const ALL_REPOS = args.includes("--all");

const FRAMEWORK_ROOT = join(import.meta.dir, "..");
const WORKSPACE_ROOT = join(FRAMEWORK_ROOT, "..");

// Known app repos with their source paths (relative to the workspace root)
const SCAN_ROOTS = ALL_REPOS
  ? [
      join(FRAMEWORK_ROOT, "packages"),
      join(WORKSPACE_ROOT, "kumiko-enterprise", "apps"),
      join(WORKSPACE_ROOT, "kumiko-studio"),
      join(WORKSPACE_ROOT, "publicstatus"),
    ]
  : [join(FRAMEWORK_ROOT, "packages")];

function shortPath(abs: string): string {
  return relative(WORKSPACE_ROOT, abs);
}

// ── Built-in-Filter ───────────────────────────────────────────────────────────

const BUILTIN_NAMES = new Set([
  "push","pop","shift","unshift","map","filter","reduce","reduceRight","forEach",
  "find","findIndex","findLast","findLastIndex","some","every","includes","indexOf",
  "lastIndexOf","slice","splice","concat","flat","flatMap","join","sort","reverse",
  "fill","copyWithin","at","entries","keys","values","from","isArray","of",
  "assign","create","fromEntries","defineProperty","getOwnPropertyNames",
  "getOwnPropertyDescriptor","hasOwn","freeze","seal",
  "replace","replaceAll","split","trim","trimStart","trimEnd","trimLeft","trimRight",
  "startsWith","endsWith","lastIndexOf","substring","padStart","padEnd","repeat",
  "match","matchAll","search","charAt","charCodeAt","toUpperCase","toLowerCase",
  "normalize","toString","valueOf",
  "stringify","parse",
  "log","error","warn","info","debug","trace","table","group","groupEnd","time","timeEnd",
  "min","max","floor","ceil","round","abs","sqrt","pow","random","sign","trunc",
  "then","catch","finally","resolve","reject","all","allSettled","race","any",
  "get","set","has","delete","clear",
  "call","apply","bind",
  "setTimeout","clearTimeout","setInterval","clearInterval",
  "String","Number","Boolean","Symbol","BigInt","Array","Object","Promise","Map","Set",
  "send","emit","on","off","once","next","done","throw","return",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

type FnNode = FunctionDeclaration | ArrowFunction | FunctionExpression;

interface FnInfo {
  name: string;
  file: string;
  line: number;
  callees: string[];
  paramCount: number;
  statementCount: number;
  isSwitchBody: boolean;       // body consists only of a switch statement
  returnsFunction: boolean;    // body returns an Arrow-/FunctionExpression (Factory pattern)
  isDirectDelegation: boolean; // the only call is directly the return value (not embedded in a template/object)
}

// ── AST helper functions ───────────────────────────────────────────────────────

function getFnName(node: FnNode): string | undefined {
  if (node.isKind(SyntaxKind.FunctionDeclaration)) return node.getName();
  const parent = node.getParent();
  if (parent?.isKind(SyntaxKind.VariableDeclaration)) {
    return (parent as VariableDeclaration).getName();
  }
  if (parent?.isKind(SyntaxKind.PropertyAssignment)) {
    return (parent as PropertyAssignment).getName();
  }
  // getName(), NOT getFirstChild(): on a MethodDeclaration with modifiers the
  // first child is the modifier keyword (`async`/`public`), not the name.
  if (parent?.isKind(SyntaxKind.MethodDeclaration)) {
    return (parent as MethodDeclaration).getName();
  }
  return undefined;
}

function getDirectCallees(node: FnNode): string[] {
  const names = new Set<string>();
  node.forEachDescendant((n) => {
    if (n.isKind(SyntaxKind.CallExpression)) {
      const expr = n.getExpression();
      if (expr.isKind(SyntaxKind.Identifier)) names.add(expr.getText());
      if (expr.isKind(SyntaxKind.PropertyAccessExpression)) names.add(expr.getName());
    }
  });
  return [...names];
}

function bodyMeta(node: FnNode): {
  statementCount: number;
  isSwitchBody: boolean;
  returnsFunction: boolean;
  isDirectDelegation: boolean;
} {
  const rawBody =
    node.isKind(SyntaxKind.ArrowFunction) && !node.getBody().isKind(SyntaxKind.Block)
      ? null  // concise arrow: x => expr — no block
      : node.getBody();

  if (!rawBody || !rawBody.isKind(SyntaxKind.Block)) {
    // Concise arrow (expr body): `x => someCall(x)`
    // isDirectDelegation = true only if the body itself is a CallExpression
    const body = node.getBody();
    const isDirectDelegation = body?.isKind(SyntaxKind.CallExpression) ?? false;
    return { statementCount: 1, isSwitchBody: false, returnsFunction: false, isDirectDelegation };
  }

  const stmts = rawBody.getStatements();
  const count = stmts.length;
  if (count !== 1) {
    return { statementCount: count, isSwitchBody: false, returnsFunction: false, isDirectDelegation: false };
  }

  const single = stmts[0];
  const isSwitchBody = single.isKind(SyntaxKind.SwitchStatement);

  let returnsFunction = false;
  let isDirectDelegation = false;

  if (single.isKind(SyntaxKind.ReturnStatement)) {
    const expr = single.getExpression();
    returnsFunction =
      expr?.isKind(SyntaxKind.ArrowFunction) ||
      expr?.isKind(SyntaxKind.FunctionExpression) ||
      false;
    // Direct delegation: `return someCall(...)` — no template, no object wrapper
    isDirectDelegation = expr?.isKind(SyntaxKind.CallExpression) ?? false;
  } else if (single.isKind(SyntaxKind.ExpressionStatement)) {
    // `someCall(...)` without return (void wrapper)
    const expr = single.getExpression();
    isDirectDelegation = expr?.isKind(SyntaxKind.CallExpression) ?? false;
  }

  return { statementCount: count, isSwitchBody, returnsFunction, isDirectDelegation };
}

// ── Wrapper detection ─────────────────────────────────────────────────────────

function isThinWrapper(fn: FnInfo): { verdict: boolean; reason: string } {
  if (fn.statementCount > 1) return { verdict: false, reason: "" };
  if (fn.isSwitchBody) return { verdict: false, reason: "" };        // switch ≠ wrapper
  if (fn.returnsFunction) return { verdict: false, reason: "" };     // factory ≠ wrapper
  if (!fn.isDirectDelegation) return { verdict: false, reason: "" }; // call in Template/Objekt ≠ wrapper
  if (fn.callees.length !== 1) return { verdict: false, reason: "" };
  if (BUILTIN_NAMES.has(fn.callees[0])) return { verdict: false, reason: "" };
  if (fn.callees[0] === fn.name) return { verdict: false, reason: "" }; // Delegation-FP / recursion

  return { verdict: true, reason: `delegiert zu \`${fn.callees[0]}\`` };
}

// ── Load project ─────────────────────────────────────────────────────────────

console.log(`\nLade TypeScript-Projekt …`);
console.log(`  Scan: ${SCAN_ROOTS.map((r) => shortPath(r)).join(", ")}\n`);

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: false, skipLibCheck: true },
});

for (const root of SCAN_ROOTS) {
  project.addSourceFilesAtPaths([
    `${root}/**/*.ts`,
    `!${root}/**/*.d.ts`,
    `!${root}/**/node_modules/**`,
    `!${root}/**/*.test.ts`,
    `!${root}/**/*.spec.ts`,
    `!${root}/**/*.integration.test.ts`,
  ]);
}

const sourceFiles = project.getSourceFiles();
console.log(`  ${sourceFiles.length} Dateien geladen.`);

// ── Collect functions ─────────────────────────────────────────────────────

const allFns: FnInfo[] = [];

for (const file of sourceFiles) {
  const filePath = shortPath(file.getFilePath());

  const collect = (node: FnNode) => {
    const name = getFnName(node);
    if (!name) return;
    const { statementCount, isSwitchBody, returnsFunction, isDirectDelegation } = bodyMeta(node);
    allFns.push({
      name,
      file: filePath,
      line: node.getStartLineNumber(),
      callees: getDirectCallees(node),
      paramCount: node.getParameters().length,
      statementCount,
      isSwitchBody,
      returnsFunction,
      isDirectDelegation,
    });
  };

  file.getFunctions().forEach(collect);
  file.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach(collect);
  file.getDescendantsOfKind(SyntaxKind.FunctionExpression).forEach(collect);
}

console.log(`  ${allFns.length} Funktionen analysiert.\n`);

// ── In-Degree ─────────────────────────────────────────────────────────────────

const inDegree = new Map<string, number>();
const calledBy = new Map<string, string[]>();

for (const fn of allFns) {
  for (const callee of fn.callees) {
    inDegree.set(callee, (inDegree.get(callee) ?? 0) + 1);
    const list = calledBy.get(callee) ?? [];
    list.push(fn.name);
    calledBy.set(callee, list);
  }
}

// ── Output: hotspots ─────────────────────────────────────────────────────────

if (SHOW_HOTSPOTS) {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  KONVERGENZ-HOTSPOTS — Funktionen mit hohem In-Degree");
  console.log("═══════════════════════════════════════════════════════\n");

  const hotspots = [...inDegree.entries()]
    .filter(([name]) => !BUILTIN_NAMES.has(name))
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_N);

  for (const [name, count] of hotspots) {
    const unique = [...new Set(calledBy.get(name) ?? [])];
    const shown = unique.slice(0, 5).join(", ");
    const more = unique.length > 5 ? ` …+${unique.length - 5}` : "";
    console.log(`  ${String(count).padStart(3)}× ${name}`);
    console.log(`       ← ${shown}${more}\n`);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("  CALL-KETTEN — Konvergenz-Pfade (Tiefe 2)");
  console.log("═══════════════════════════════════════════════════════\n");

  const top5 = [...inDegree.entries()]
    .filter(([name]) => !BUILTIN_NAMES.has(name))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  for (const [target] of top5) {
    const directCallers = [...new Set(calledBy.get(target) ?? [])];
    const chains: string[] = [];
    for (const caller of directCallers.slice(0, 8)) {
      const upstream = [...new Set(calledBy.get(caller) ?? [])];
      if (upstream.length > 0) {
        chains.push(`${upstream.slice(0, 3).join(" / ")} → ${caller} → ${target}`);
      }
    }
    if (chains.length > 0) {
      console.log(`  ${target}:`);
      chains.forEach((c) => console.log(`    ${c}`));
      console.log();
    }
  }
}

// ── Output: thin wrappers ─────────────────────────────────────────────────────

if (SHOW_WRAPPERS) {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  THIN-WRAPPER — Funktionen die nur delegieren");
  console.log("═══════════════════════════════════════════════════════\n");

  const wrappers = allFns
    .map((fn) => ({ fn, check: isThinWrapper(fn) }))
    .filter(({ check }) => check.verdict);

  if (wrappers.length === 0) {
    console.log("  Keine gefunden.\n");
  } else {
    for (const { fn, check } of wrappers) {
      console.log(`  ${fn.name}`);
      console.log(`    ${fn.file}:${fn.line}`);
      console.log(`    ${check.reason}\n`);
    }
    console.log(`  Gesamt: ${wrappers.length} Thin-Wrapper.\n`);
  }
}
