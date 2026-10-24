#!/usr/bin/env bun
/**
 * Guard: row-level-security settings are transaction-local and written in one place.
 *
 * The scope lives in the `kumiko.*` settings that `packages/framework/src/db/queries/rls-scope.ts`
 * sets per statement transaction. A session-level setting survives on a pooled connection and leaks
 * one request's scope into the next, so in every source and test string:
 *
 * 1. `SET kumiko.…` / `SET SESSION kumiko.…` is flagged (use `SET LOCAL`).
 * 2. Every `set_config` passes the literal `true` as is_local.
 * 3. Outside rls-scope.ts, non-test code writes no `kumiko.*` setting at all, and a `set_config`
 *    with a dynamic setting name is flagged because it cannot be proven to leave `kumiko.*` alone.
 *
 * `.sql` files (consumer migrations) are checked statement by statement under the same rules.
 *
 * Usage:
 *   bun guards/guard-rls-session-settings.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import { existsSync, readFileSync } from "node:fs";
import { Glob } from "bun";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  isAllowlisted,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";
import { TEST_FILE_RE } from "./_lib/test-file";

const SCAN: ScanSpec = {
  kinds: ALL_REPO_KINDS,
  scope: "source+tests",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const SCOPE_WRITER = [/^packages\/framework\/src\/db\/queries\/rls-scope\.ts$/];

// The assignment tail separates SQL from prose such as "Set kumiko.deploy.infraRef to an infra tag".
const ASSIGNMENT = String.raw`"?kumiko\.[\w.]+"?\s*(?:=|TO\s+['"$\d])`;
const SESSION_SET_RE = new RegExp(String.raw`\bSET\s+(?:SESSION\s+)?${ASSIGNMENT}`, "i");
const LOCAL_SET_RE = new RegExp(String.raw`\bSET\s+LOCAL\s+${ASSIGNMENT}`, "i");
const SET_CONFIG_CALL_RE = /\bset_config\s*\(/gi;

function isTestFile(rel: string): boolean {
  return rel.split("/").includes("__tests__") || TEST_FILE_RE.test(rel);
}

const QUOTES = "'\"`";
const OPENERS = "([{";
const CLOSERS = ")]}";

// Top-level comma-separated arguments of the call whose "(" ends right before `from`.
function callArguments(text: string, from: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";
  for (let i = from; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== undefined) {
      current += c;
      if (c === quote) quote = undefined;
      continue;
    }
    if (QUOTES.includes(c)) quote = c;
    else if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  args.push(current.trim());
  return args;
}

function setConfigCalls(text: string): string[][] {
  return [...text.matchAll(SET_CONFIG_CALL_RE)].map((m) =>
    callArguments(text, m.index + m[0].length).map((arg) => arg.toLowerCase()),
  );
}

function isKumikoLiteral(arg: string | undefined): boolean {
  return arg !== undefined && /^['"`]kumiko\./.test(arg);
}

function isStringLiteralArgument(arg: string | undefined): boolean {
  return arg !== undefined && /^['"`]/.test(arg);
}

function setConfigMessages(text: string, isScopeWriter: boolean, isTest: boolean): string[] {
  const calls = setConfigCalls(text);
  const messages: string[] = [];
  if (calls.some((args) => args[2] !== "true")) {
    messages.push(
      "set_config must pass the literal true as is_local, anything else can be session-level",
    );
  }
  if (isScopeWriter || isTest) return messages;
  if (calls.some((args) => isKumikoLiteral(args[0]))) {
    messages.push("only rls-scope.ts may write a kumiko.* setting");
  }
  if (calls.some((args) => !isStringLiteralArgument(args[0]))) {
    messages.push(
      "set_config with a dynamic setting name cannot be proven to leave kumiko.* alone",
    );
  }
  return messages;
}

function violationsInText(text: string, rel: string): string[] {
  const isScopeWriter = isAllowlisted(rel, SCOPE_WRITER);
  const isTest = isTestFile(rel);
  const messages: string[] = [];
  if (SESSION_SET_RE.test(text)) {
    messages.push("SET / SET SESSION on a kumiko.* setting is session-level; use SET LOCAL");
  }
  if (!isScopeWriter && !isTest && LOCAL_SET_RE.test(text)) {
    messages.push("only rls-scope.ts may write a kumiko.* setting");
  }
  return [...messages, ...setConfigMessages(text, isScopeWriter, isTest)];
}

function isStringLike(node: Node): boolean {
  return (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTemplateExpression(node)
  );
}

function findSessionSettings(sf: SourceFile, rel: string) {
  const found: Array<{ line: number; message: string }> = [];
  for (const node of sf.getDescendants()) {
    if (!isStringLike(node)) continue;
    // A template's own spans are visited as separate nodes; its full text is checked once here.
    if (node.getParent()?.getKind() === SyntaxKind.TemplateSpan) continue;
    for (const message of violationsInText(node.getText(), rel)) {
      found.push({ line: node.getStartLineNumber(), message: `[rls-session-setting] ${message}` });
    }
  }
  return found;
}

const SQL_IGNORED_DIRS = /(^|\/)(node_modules|\.wt|\.git|dist)(\/|$)/;

// Statements split on ";" with their start line; "--" comment lines are blanked so prose in them never matches.
export function findSqlSessionSettings(sql: string, rel: string) {
  const found: Array<{ line: number; message: string }> = [];
  const code = sql.replace(/^\s*--.*$/gm, "");
  let line = 1;
  for (const statement of code.split(";")) {
    const startLine =
      line + countNewlines(statement.slice(0, statement.length - statement.trimStart().length));
    for (const message of violationsInText(statement, rel)) {
      found.push({ line: startLine, message: `[rls-session-setting] ${message}` });
    }
    line += countNewlines(statement);
  }
  return found;
}

function countNewlines(text: string): number {
  return text.split("\n").length - 1;
}

function sqlFilesOf(rootDir: string): string[] {
  // skip: in-memory roots of guard tests have no directory
  if (!existsSync(rootDir)) return [];
  return [...new Glob("**/*.sql").scanSync({ cwd: rootDir })].filter(
    (file) => !SQL_IGNORED_DIRS.test(file),
  );
}

export const guard: AstGuard = {
  name: "RLS-Session-Settings Guard",
  scan: SCAN,
  hint: "Row-level-security settings must be transaction-local: use SET LOCAL or pass true as the third set_config argument. Only packages/framework/src/db/queries/rls-scope.ts writes the kumiko.* scope; tests may use SET LOCAL.",
  run(files, roots = resolveRepoRoots()) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    for (const sf of files) {
      const rel = relFromRepoRoot(sf.getFilePath(), roots);
      for (const f of findSessionSettings(sf, rel)) violations.push({ file: rel, ...f });
    }
    for (const root of roots) {
      for (const file of sqlFilesOf(root.absPath)) {
        const sql = readFileSync(`${root.absPath}/${file}`, "utf8");
        for (const f of findSqlSessionSettings(sql, file)) violations.push({ file, ...f });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
