#!/usr/bin/env bun
// object-form — rewrites the positional registrar calls r.writeHandler / r.queryHandler /
// r.entity / r.requires / r.hook to their object form and registerEntityCrud(r, …) to
// r.crud(…). The positional overloads are gone; the object form is the only API.
//
// Usage:
//   bun scripts/codemod/object-form.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type CallExpression,
  type ImportSpecifier,
  Node,
  type ParameterDeclaration,
  Project,
  SyntaxKind,
} from "ts-morph";
import { collectSourceFiles } from "./collect-source-files.js";

export const REGISTRAR_METHODS = [
  "writeHandler",
  "queryHandler",
  "entity",
  "requires",
  "hook",
] as const;
export type RegistrarMethod = (typeof REGISTRAR_METHODS)[number];
export type ObjectFormMethod = RegistrarMethod | "registerEntityCrud";

const CRUD_FUNCTION_NAME = "registerEntityCrud";
const REGISTRAR_TYPE_MARKER = "FeatureRegistrar";
const REGISTRAR_RECEIVER_NAMES: ReadonlySet<string> = new Set(["r", "registrar"]);
const FEATURE_FACTORY_NAME = "defineFeature";
const CHEAP_PREFILTER = /\b(writeHandler|queryHandler|entity|requires|hook|registerEntityCrud)\b/;

export interface ObjectFormRewrite {
  readonly file: string;
  readonly line: number;
  readonly method: ObjectFormMethod;
}

export interface ObjectFormManualSite extends ObjectFormRewrite {
  readonly why: string;
}

export interface ObjectFormResult {
  readonly output: string;
  readonly rewrites: ObjectFormRewrite[];
  readonly manual: ObjectFormManualSite[];
}

export type ReceiverResolution = "registrar" | "other" | "unresolved";

function isRegistrarMethod(name: string): name is RegistrarMethod {
  return (REGISTRAR_METHODS as readonly string[]).includes(name);
}

function isFeatureFactoryCallee(callee: Node): boolean {
  if (Node.isIdentifier(callee)) return callee.getText() === FEATURE_FACTORY_NAME;
  if (Node.isPropertyAccessExpression(callee)) return callee.getName() === FEATURE_FACTORY_NAME;
  return false;
}

function isFeatureCallbackParameter(param: ParameterDeclaration): boolean {
  const fn = param.getParent();
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false;
  if (fn.getParameters()[0] !== param) return false;
  const call = fn.getParentIfKind(SyntaxKind.CallExpression);
  return (
    call !== undefined &&
    call.getArguments()[1] === fn &&
    isFeatureFactoryCallee(call.getExpression())
  );
}

function resolveParameter(param: ParameterDeclaration): ReceiverResolution {
  if (isFeatureCallbackParameter(param)) return "registrar";
  const typeNode = param.getTypeNode();
  if (typeNode === undefined) return "unresolved";
  return typeNode.getText().includes(REGISTRAR_TYPE_MARKER) ? "registrar" : "other";
}

function declaredVariableIn(scope: Node, name: string): ReceiverResolution | undefined {
  if (!Node.isBlock(scope) && !Node.isSourceFile(scope) && !Node.isModuleBlock(scope)) {
    return undefined;
  }
  for (const statement of scope.getStatements()) {
    if (!Node.isVariableStatement(statement)) continue;
    for (const declaration of statement.getDeclarations()) {
      if (declaration.getNameNode().getText() !== name) continue;
      const typeText = declaration.getTypeNode()?.getText();
      if (typeText === undefined) return "unresolved";
      return typeText.includes(REGISTRAR_TYPE_MARKER) ? "registrar" : "other";
    }
  }
  return undefined;
}

// Scope walk instead of a type checker: the nearest binding of the receiver's name decides.
export function resolveReceiver(receiver: Node): ReceiverResolution {
  if (!Node.isIdentifier(receiver)) return "other";
  const name = receiver.getText();
  for (
    let scope: Node | undefined = receiver.getParent();
    scope !== undefined;
    scope = scope.getParent()
  ) {
    if (Node.isParametered(scope)) {
      const param = scope.getParameters().find((p) => p.getNameNode().getText() === name);
      if (param !== undefined) return resolveParameter(param);
    }
    const variable = declaredVariableIn(scope, name);
    if (variable !== undefined) return variable;
  }
  return "unresolved";
}

export function isFeatureRegistrarReceiver(receiver: Node): boolean {
  return resolveReceiver(receiver) === "registrar";
}

function isUnresolvedRegistrarLookalike(receiver: Node): boolean {
  return (
    Node.isIdentifier(receiver) &&
    REGISTRAR_RECEIVER_NAMES.has(receiver.getText()) &&
    resolveReceiver(receiver) === "unresolved"
  );
}

export function isPositionalShape(method: RegistrarMethod, args: readonly Node[]): boolean {
  if (method === "requires") return args.some((arg) => !Node.isObjectLiteralExpression(arg));
  // The object form takes exactly one argument, so a spread can only be a positional call.
  if (args.some((arg) => Node.isSpreadElement(arg))) return true;
  return args.length >= (method === "hook" ? 3 : 2);
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly render: () => string;
}

type Plan = { readonly edit: Edit } | { readonly why: string };

let sharedProject: Project | undefined;

function parserProject(): Project {
  sharedProject ??= new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
  });
  return sharedProject;
}

function lastLineHasLineComment(piece: string): boolean {
  return piece.slice(piece.lastIndexOf("\n") + 1).includes("//");
}

function terminated(piece: string): string {
  if (lastLineHasLineComment(piece)) return `${piece}\n,`;
  return piece.endsWith(",") ? piece : `${piece},`;
}

function composeObjectCall(pieces: readonly string[]): string {
  const parts = pieces.filter((piece) => piece.length > 0);
  const last = parts.at(-1) ?? "";
  const body = [...parts.slice(0, -1).map(terminated), last].join(" ");
  return `({ ${body}${lastLineHasLineComment(last) ? "\n" : " "}})`;
}

class SourceRewriter {
  private readonly edits: Edit[] = [];
  readonly rewrites: ObjectFormRewrite[] = [];
  readonly manual: ObjectFormManualSite[] = [];

  constructor(
    private readonly text: string,
    private readonly fileName: string,
  ) {}

  addEdit(edit: Edit): void {
    this.edits.push(edit);
  }

  site(call: Node, method: ObjectFormMethod): ObjectFormRewrite {
    return { file: this.fileName, line: call.getStartLineNumber(), method };
  }

  recordPlan(call: Node, method: ObjectFormMethod, plan: Plan): void {
    if ("why" in plan) {
      this.manual.push({ ...this.site(call, method), why: plan.why });
      return;
    }
    this.edits.push(plan.edit);
    this.rewrites.push(this.site(call, method));
  }

  recordManual(call: Node, method: ObjectFormMethod, why: string): void {
    this.manual.push({ ...this.site(call, method), why });
  }

  // Source between two offsets with every contained edit applied, so a rewritten call nested in
  // an argument of another rewritten call is rendered once, inside the outer replacement.
  textOf = (start: number, end: number): string => {
    const ordered = [...this.edits].sort((a, b) => a.start - b.start || b.end - a.end);
    let out = "";
    let cursor = start;
    for (const edit of ordered) {
      if (edit.start < cursor || edit.end > end) continue;
      out += this.text.slice(cursor, edit.start) + edit.render();
      cursor = edit.end;
    }
    return out + this.text.slice(cursor, end);
  };

  commaEndAfter(position: number): number {
    let i = position;
    while (i < this.text.length) {
      const ch = this.text[i];
      if (ch === ",") return i + 1;
      if (this.text.startsWith("/*", i)) {
        const close = this.text.indexOf("*/", i + 2);
        i = close === -1 ? this.text.length : close + 2;
      } else if (this.text.startsWith("//", i)) {
        const newline = this.text.indexOf("\n", i);
        i = newline === -1 ? this.text.length : newline + 1;
      } else {
        i += 1;
      }
    }
    return position;
  }

  // Leading comments stay attached: the slice starts right after the previous comma / the paren.
  argSource(call: CallExpression, index: number): string {
    const args = call.getArguments();
    const arg = args[index];
    if (arg === undefined) return "";
    const previous = args[index - 1];
    const start =
      previous !== undefined
        ? this.commaEndAfter(previous.getEnd())
        : (call.getFirstChildByKind(SyntaxKind.OpenParenToken)?.getEnd() ?? arg.getStart());
    return this.textOf(start, arg.getEnd()).trimStart();
  }

  fieldFrom(call: CallExpression, index: number, field: string): string {
    const source = this.argSource(call, index);
    return source === field ? field : `${field}: ${source}`;
  }

  // Property list of an object literal, comments inside it included, outer braces and trailing comma cut.
  innerOf(literal: Node): string {
    const inner = this.textOf(literal.getStart() + 1, literal.getEnd() - 1).trim();
    return inner.endsWith(",") ? inner.slice(0, -1).trimEnd() : inner;
  }

  spreadOrInline(call: CallExpression, index: number): string {
    const arg = call.getArguments()[index];
    if (arg !== undefined && Node.isObjectLiteralExpression(arg)) return this.innerOf(arg);
    return `...${this.argSource(call, index)}`;
  }

  // Replaces everything after the callee (type arguments and the argument list).
  objectCallEdit(call: CallExpression, pieces: () => readonly string[]): Edit {
    return {
      start: call.getExpression().getEnd(),
      end: call.getEnd(),
      render: () => composeObjectCall(pieces()),
    };
  }
}

function hasSpreadArgument(args: readonly Node[]): boolean {
  return args.some((arg) => Node.isSpreadElement(arg));
}

function planHandler(
  rewriter: SourceRewriter,
  call: CallExpression,
  fieldNames: readonly [string, string, string],
): Plan {
  const args = call.getArguments();
  if (hasSpreadArgument(args)) return { why: "spread argument — rewrite by hand" };
  if (Node.isObjectLiteralExpression(args[0])) {
    return { why: "first argument is an object literal — not the positional form" };
  }
  if (args.length < 3) return { why: "fewer than 3 arguments (name, schema, handler)" };
  if (args.length > 4) return { why: "more than 4 arguments" };
  const options = args[3];
  return {
    edit: rewriter.objectCallEdit(call, () => [
      ...fieldNames.map((field, index) => rewriter.fieldFrom(call, index, field)),
      options === undefined ? "" : rewriter.spreadOrInline(call, 3),
    ]),
  };
}

type BackingTableField = (() => string) | { readonly why: string };

function backingTableOf(rewriter: SourceRewriter, call: CallExpression): BackingTableField {
  const options = call.getArguments()[2];
  if (options === undefined) return () => "";
  if (!Node.isObjectLiteralExpression(options)) {
    return { why: "entity options argument is not an object literal" };
  }
  const only = options.getProperties()[0];
  const invalid = { why: "entity options must contain exactly `table`" };
  if (options.getProperties().length !== 1 || only === undefined) return invalid;
  if (Node.isShorthandPropertyAssignment(only) && only.getName() === "table") {
    return () => "backingTable: table";
  }
  if (Node.isPropertyAssignment(only) && only.getName() === "table") {
    const initializer = only.getInitializer();
    if (initializer === undefined) return { why: "entity `table` option has no value" };
    return () => `backingTable: ${rewriter.textOf(initializer.getStart(), initializer.getEnd())}`;
  }
  return invalid;
}

function planEntity(rewriter: SourceRewriter, call: CallExpression): Plan {
  const args = call.getArguments();
  if (hasSpreadArgument(args)) return { why: "spread argument — rewrite by hand" };
  if (Node.isObjectLiteralExpression(args[0])) {
    return { why: "first argument is an object literal — not the positional form" };
  }
  if (args.length > 3) return { why: "more than 3 arguments" };
  const backingTable = backingTableOf(rewriter, call);
  if ("why" in backingTable) return backingTable;
  return {
    edit: rewriter.objectCallEdit(call, () => [
      rewriter.fieldFrom(call, 0, "name"),
      rewriter.spreadOrInline(call, 1),
      backingTable(),
    ]),
  };
}

function planRequires(rewriter: SourceRewriter, call: CallExpression): Plan {
  const args = call.getArguments();
  if (args.some((arg) => Node.isObjectLiteralExpression(arg))) {
    return { why: "mixes object literals with feature names" };
  }
  return {
    edit: rewriter.objectCallEdit(call, () => [
      `features: [${args.map((_, index) => rewriter.argSource(call, index)).join(", ")}]`,
    ]),
  };
}

function planHook(rewriter: SourceRewriter, call: CallExpression): Plan {
  const args = call.getArguments();
  if (hasSpreadArgument(args)) return { why: "spread argument — rewrite by hand" };
  if (args.length > 4) return { why: "more than 4 arguments" };
  return {
    edit: rewriter.objectCallEdit(call, () => [
      rewriter.fieldFrom(call, 0, "type"),
      rewriter.fieldFrom(call, 1, "target"),
      rewriter.fieldFrom(call, 2, "handler"),
      args[3] === undefined ? "" : rewriter.spreadOrInline(call, 3),
    ]),
  };
}

function planRegistrarCall(
  rewriter: SourceRewriter,
  call: CallExpression,
  method: RegistrarMethod,
): Plan {
  switch (method) {
    case "writeHandler":
    case "queryHandler":
      return planHandler(rewriter, call, ["name", "schema", "handler"]);
    case "entity":
      return planEntity(rewriter, call);
    case "requires":
      return planRequires(rewriter, call);
    case "hook":
      return planHook(rewriter, call);
  }
}

function crudImportsByLocalName(sourceFile: Node): Map<string, ImportSpecifier> {
  const byLocalName = new Map<string, ImportSpecifier>();
  for (const specifier of sourceFile.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    if (specifier.getName() !== CRUD_FUNCTION_NAME) continue;
    byLocalName.set(specifier.getAliasNode()?.getText() ?? specifier.getName(), specifier);
  }
  return byLocalName;
}

function planCrud(rewriter: SourceRewriter, call: CallExpression, text: string): Plan {
  const args = call.getArguments();
  if (hasSpreadArgument(args)) return { why: "spread argument — rewrite by hand" };
  if (args.length < 3) return { why: "fewer than 3 arguments (registrar, name, entity)" };
  const receiver = args[0];
  const second = args[1];
  if (receiver === undefined || second === undefined) return { why: "missing arguments" };
  if (!Node.isIdentifier(receiver)) {
    return {
      why: "first argument is not a plain identifier — rewrite to <registrar>.crud(…) by hand",
    };
  }
  const resolution = resolveReceiver(receiver);
  const looksLikeRegistrar =
    resolution === "registrar" ||
    (resolution === "unresolved" && REGISTRAR_RECEIVER_NAMES.has(receiver.getText()));
  if (!looksLikeRegistrar) {
    return {
      why: `first argument \`${receiver.getText()}\` is not a recognized FeatureRegistrar — rewrite to <registrar>.crud(…) by hand`,
    };
  }
  const start = call.getStart();
  const commaEnd = rewriter.commaEndAfter(receiver.getEnd());
  const gap = text.slice(commaEnd, second.getStart());
  const end = gap.trim() === "" ? second.getStart() : commaEnd;
  return { edit: { start, end, render: () => `${receiver.getText()}.crud(` } };
}

function removeImportSpecifierEdit(specifier: ImportSpecifier): Edit {
  const declaration = specifier.getImportDeclaration();
  const named = declaration.getNamedImports();
  if (
    named.length === 1 &&
    declaration.getDefaultImport() === undefined &&
    declaration.getNamespaceImport() === undefined
  ) {
    const sourceText = declaration.getSourceFile().getFullText();
    const start = declaration.getStart();
    let end = declaration.getEnd();
    if (sourceText[end] === "\n") end += 1;
    return { start, end, render: () => "" };
  }
  const index = named.indexOf(specifier);
  const next = named[index + 1];
  const previous = named[index - 1];
  if (next !== undefined) {
    return { start: specifier.getStart(), end: next.getStart(), render: () => "" };
  }
  return {
    start: previous?.getEnd() ?? specifier.getStart(),
    end: specifier.getEnd(),
    render: () => "",
  };
}

function isOwnedByImport(node: Node): boolean {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) !== undefined;
}

export function transformObjectFormSource(text: string, fileName = "snippet.ts"): ObjectFormResult {
  if (!CHEAP_PREFILTER.test(text)) return { output: text, rewrites: [], manual: [] };

  const project = parserProject();
  const sourceFile = project.createSourceFile(fileName, text, { overwrite: true });
  const rewriter = new SourceRewriter(text, fileName);
  const crudImports = crudImportsByLocalName(sourceFile);
  const rewrittenCrudCallees = new Set<Node>();

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();

    if (Node.isIdentifier(callee) && crudImports.has(callee.getText())) {
      const plan = planCrud(rewriter, call, text);
      rewriter.recordPlan(call, CRUD_FUNCTION_NAME, plan);
      if (!("why" in plan)) rewrittenCrudCallees.add(callee);
      continue;
    }

    if (!Node.isPropertyAccessExpression(callee)) continue;
    const method = callee.getName();
    if (!isRegistrarMethod(method)) continue;
    const args = call.getArguments();
    if (!isPositionalShape(method, args)) continue;

    const receiver = callee.getExpression();
    if (isFeatureRegistrarReceiver(receiver)) {
      rewriter.recordPlan(call, method, planRegistrarCall(rewriter, call, method));
    } else if (isUnresolvedRegistrarLookalike(receiver)) {
      rewriter.recordManual(
        call,
        method,
        `receiver \`${receiver.getText()}\` is not a resolvable FeatureRegistrar (no defineFeature callback parameter or FeatureRegistrar-typed binding) — rewrite by hand`,
      );
    }
  }

  for (const [localName, specifier] of crudImports) {
    const remainingUses = sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter(
        (id) => id.getText() === localName && !isOwnedByImport(id) && !rewrittenCrudCallees.has(id),
      );
    if (remainingUses.length === 0) rewriter.addEdit(removeImportSpecifierEdit(specifier));
    for (const use of remainingUses) {
      if (use.getParentIfKind(SyntaxKind.CallExpression)?.getExpression() === use) continue;
      rewriter.recordManual(
        use,
        CRUD_FUNCTION_NAME,
        "referenced other than as a direct call — migrate by hand",
      );
    }
  }

  const output = rewriter.textOf(0, text.length);
  project.removeSourceFile(sourceFile);
  return { output, rewrites: rewriter.rewrites, manual: rewriter.manual };
}

class CliError extends Error {}

type Mode = "write" | "dry-run" | "check";

interface CliOptions {
  readonly mode: Mode;
  readonly format: boolean;
  readonly paths: string[];
}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: Mode | undefined;
  let format = true;
  const paths: string[] = [];
  const setMode = (next: Mode): void => {
    if (mode !== undefined && mode !== next)
      throw new CliError("--check, --dry-run and --write are mutually exclusive");
    mode = next;
  };
  for (const arg of argv) {
    if (arg === "--check") setMode("check");
    else if (arg === "--dry-run") setMode("dry-run");
    else if (arg === "--write") setMode("write");
    else if (arg === "--no-format") format = false;
    else if (arg.startsWith("--")) throw new CliError(`unknown flag: ${arg}`);
    else paths.push(arg);
  }
  if (paths.length === 0) throw new CliError("at least one target directory is required");
  return { mode: mode ?? "write", format, paths };
}

function isMigratableFile(name: string): boolean {
  return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts");
}

function isFixturePath(file: string): boolean {
  return file.includes("/__tests__/fixtures/");
}

function findBiomeBinary(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, "node_modules", ".bin", "biome");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const FORMAT_BATCH_SIZE = 50;

async function formatWithBiome(files: readonly string[], cwd: string): Promise<void> {
  const biome = findBiomeBinary(cwd);
  if (biome === undefined) {
    console.log(
      "[object-form] biome not found in node_modules/.bin — format the changed files yourself",
    );
    return;
  }
  for (let i = 0; i < files.length; i += FORMAT_BATCH_SIZE) {
    const batch = files.slice(i, i + FORMAT_BATCH_SIZE);
    const proc = Bun.spawn({
      cmd: [biome, "format", "--write", "--no-errors-on-unmatched", ...batch],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) {
      console.log(
        `[object-form] biome format exited ${exitCode}; run it on the changed files yourself\n${stderr.trim()}`,
      );
    }
  }
}

function displayPath(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

function countByMethod(rewrites: readonly ObjectFormRewrite[]): string {
  const methods: readonly ObjectFormMethod[] = [...REGISTRAR_METHODS, CRUD_FUNCTION_NAME];
  return methods
    .map((method) => `${method} ${rewrites.filter((r) => r.method === method).length}`)
    .join(", ");
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`[object-form] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const files = collectSourceFiles(options.paths, { isMigratableFile }).filter(
    (file) => !isFixturePath(file),
  );
  const allRewrites: ObjectFormRewrite[] = [];
  const allManual: ObjectFormManualSite[] = [];
  const changedFiles: string[] = [];

  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = transformObjectFormSource(before, file);
    const shown = displayPath(file);
    for (const site of result.rewrites)
      console.log(`${shown}:${site.line}  ${site.method}  rewritten`);
    for (const site of result.manual) {
      console.log(`${shown}:${site.line}  ${site.method}  manual: ${site.why}`);
    }
    allRewrites.push(...result.rewrites);
    allManual.push(...result.manual);
    if (options.mode === "write" && result.output !== before) {
      writeFileSync(file, result.output);
      changedFiles.push(file);
    }
  }

  console.log(
    `\n[object-form] ${options.mode === "write" ? "rewritten" : "rewritable"}: ${allRewrites.length} (${countByMethod(allRewrites)}); manual: ${allManual.length}`,
  );

  if (options.mode === "write" && options.format && changedFiles.length > 0) {
    await formatWithBiome(changedFiles, resolve(options.paths[0] ?? "."));
  }

  const hasOpenSites = allRewrites.length + allManual.length > 0;
  process.exit(options.mode === "check" && hasOpenSites ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
