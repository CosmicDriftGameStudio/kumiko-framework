#!/usr/bin/env bun
// registrar-single-form — the registrar verbs optionalRequires, readsConfig, relation, config, job,
// notification, referenceData, metric, secret, secretNamespace, claimKey and streamHandler take one
// options object; r.useExtension is r.applyExtension. This rewrites positional calls to the object
// form, renames useExtension and drops the useHookAtTopLevel biome-ignore above it.
//
// Usage:
//   bun scripts/codemod/registrar-single-form.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { type CallExpression, Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { type CodemodResult, type CodemodSite, runCodemodCli } from "./codemod-support.ts";
import { isUnresolvedRegistrarLookalike, resolveReceiver } from "./registrar-receiver.ts";
import {
  ALL_VERB_NAMES,
  CONFIG_VERB,
  LIST_VERBS,
  type ListVerbSpec,
  VERB_SPECS,
  type VerbSpec,
} from "./registrar-single-form-verbs.ts";

const CHEAP_PREFILTER = new RegExp(`\\b(${ALL_VERB_NAMES.join("|")})\\b`);
const HOOK_BIOME_IGNORE = /^\s*\/\/\s*biome-ignore\s+lint\/correctness\/useHookAtTopLevel\b/;
const IDENTIFIER_KEY = /^[A-Za-z_$][\w$]*$/;
const SPREAD_REASON = "spread argument, rewrite by hand";

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly render: () => string;
}

type Plan = { readonly edit: Edit } | { readonly why: string };

type Shape = "positional" | "object" | "ambiguous" | "spread" | "none";

let sharedProject: Project | undefined;

function parserProject(): Project {
  sharedProject ??= new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
  });
  return sharedProject;
}

function isStringish(node: Node): boolean {
  return (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTemplateExpression(node)
  );
}

function shapeOf(args: readonly Node[], isList: boolean): Shape {
  if (args.some((arg) => Node.isSpreadElement(arg))) return "spread";
  const first = args[0];
  if (first === undefined) return "none";
  if (isList) {
    if (args.every((arg) => Node.isObjectLiteralExpression(arg))) return "object";
    return args.length > 1 || args.some(isStringish) ? "positional" : "ambiguous";
  }
  if (args.length > 1) return "positional";
  return isStringish(first) ? "positional" : "object";
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
  readonly rewrites: CodemodSite[] = [];
  readonly manual: CodemodSite[] = [];

  constructor(
    private readonly text: string,
    private readonly fileName: string,
  ) {}

  addEdit(edit: Edit): void {
    this.edits.push(edit);
  }

  recordRewrite(node: Node, description: string): void {
    this.rewrites.push({ file: this.fileName, line: node.getStartLineNumber(), description });
  }

  recordManual(node: Node, description: string): void {
    this.manual.push({ file: this.fileName, line: node.getStartLineNumber(), description });
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
      if (this.text[i] === ",") return i + 1;
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
    if (arg === undefined) return "";
    if (Node.isObjectLiteralExpression(arg)) return this.innerOf(arg);
    return `...${this.argSource(call, index)}`;
  }

  // Every line comment sits on its own line, so removing the whole line leaves the code untouched.
  hookBiomeIgnoreEdit(call: CallExpression): Edit | undefined {
    const anchor = call.getParentIfKind(SyntaxKind.ExpressionStatement) ?? call;
    const lineStart = this.text.lastIndexOf("\n", anchor.getStart() - 1) + 1;
    if (lineStart === 0) return undefined;
    const previousStart = this.text.lastIndexOf("\n", lineStart - 2) + 1;
    if (!HOOK_BIOME_IGNORE.test(this.text.slice(previousStart, lineStart - 1))) return undefined;
    return { start: previousStart, end: lineStart, render: () => "" };
  }
}

function planList(rewriter: SourceRewriter, call: CallExpression, spec: ListVerbSpec): Plan {
  const items = call.getArguments().map((_, index) => rewriter.argSource(call, index));
  return {
    edit: {
      start: call.getExpression().getEnd(),
      end: call.getEnd(),
      render: () => composeObjectCall([`${spec.field}: [${items.join(", ")}]`]),
    },
  };
}

function planConfig(rewriter: SourceRewriter, call: CallExpression): Plan {
  const args = call.getArguments();
  if (args.length < 2) return { why: "missing argument (r.config needs a key and a definition)" };
  if (args.length > 2) return { why: "more than 2 arguments" };
  const keyNode = args[0];
  if (keyNode === undefined || !isStringish(keyNode)) {
    return { why: "config key is not a string literal, rewrite by hand" };
  }
  const key = keyNode.getText().slice(1, -1);
  if (!Node.isStringLiteral(keyNode) || !IDENTIFIER_KEY.test(key)) {
    return { why: `config key ${keyNode.getText()} is not an identifier, rewrite by hand` };
  }
  return {
    edit: {
      start: call.getExpression().getEnd(),
      end: call.getEnd(),
      render: () =>
        `${composeObjectCall([`keys: { ${key}: ${rewriter.argSource(call, 1)} }`])}.${key}`,
    },
  };
}

function planVerb(rewriter: SourceRewriter, call: CallExpression, spec: VerbSpec): Plan {
  const args = call.getArguments();
  if (args.length < spec.requiredArgs) {
    return { why: `missing argument (r.${spec.verb} needs ${spec.requiredArgs})` };
  }
  if (args.length > spec.maxArgs) return { why: `more than ${spec.maxArgs} arguments` };
  const callee = call.getExpression();
  const renamed = spec.renameTo !== undefined && Node.isPropertyAccessExpression(callee);
  return {
    edit: {
      start: renamed ? callee.getNameNode().getStart() : callee.getEnd(),
      end: call.getEnd(),
      render: () =>
        `${renamed ? spec.renameTo : ""}${composeObjectCall(
          spec.pieces.map((piece) =>
            piece.kind === "field"
              ? rewriter.fieldFrom(call, piece.arg, piece.name)
              : rewriter.spreadOrInline(call, piece.arg),
          ),
        )}`,
    },
  };
}

type Verb =
  | { readonly kind: "list"; readonly spec: ListVerbSpec }
  | { readonly kind: "config" }
  | { readonly kind: "verb"; readonly spec: VerbSpec };

function verbOf(name: string): Verb | undefined {
  const list = LIST_VERBS.find((spec) => spec.verb === name);
  if (list !== undefined) return { kind: "list", spec: list };
  if (name === CONFIG_VERB) return { kind: "config" };
  const spec = VERB_SPECS.find((candidate) => candidate.verb === name);
  return spec === undefined ? undefined : { kind: "verb", spec };
}

function planPositional(rewriter: SourceRewriter, call: CallExpression, verb: Verb): Plan {
  if (verb.kind === "list") return planList(rewriter, call, verb.spec);
  if (verb.kind === "config") return planConfig(rewriter, call);
  return planVerb(rewriter, call, verb.spec);
}

function renameOnlyEdit(call: CallExpression, renameTo: string): Edit | undefined {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const nameNode = callee.getNameNode();
  return { start: nameNode.getStart(), end: nameNode.getEnd(), render: () => renameTo };
}

function applyPlan(rewriter: SourceRewriter, call: CallExpression, name: string, plan: Plan): void {
  if ("why" in plan) {
    rewriter.recordManual(call, `r.${name}: ${plan.why}`);
    return;
  }
  rewriter.addEdit(plan.edit);
  rewriter.recordRewrite(call, `r.${name}: positional -> object form`);
}

function dropHookBiomeIgnore(rewriter: SourceRewriter, call: CallExpression): void {
  const edit = rewriter.hookBiomeIgnoreEdit(call);
  if (edit !== undefined) rewriter.addEdit(edit);
}

function visitCall(rewriter: SourceRewriter, call: CallExpression): void {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return;
  const name = callee.getName();
  const verb = verbOf(name);
  if (verb === undefined) return;
  const receiver = callee.getExpression();
  const resolution = resolveReceiver(receiver);
  const isRegistrar = resolution === "registrar";
  if (!isRegistrar && !isUnresolvedRegistrarLookalike(receiver)) return;

  const args = call.getArguments();
  const shape = shapeOf(args, verb.kind === "list");
  const renameTo = verb.kind === "verb" ? verb.spec.renameTo : undefined;
  if (shape === "object" && renameTo === undefined) return;

  const unresolvedWhy = `receiver \`${receiver.getText()}\` is not a resolvable FeatureRegistrar (no defineFeature callback parameter or FeatureRegistrar-typed binding), rewrite by hand`;
  if (shape === "spread") {
    rewriter.recordManual(call, `r.${name}: ${SPREAD_REASON}`);
    return;
  }
  if (shape === "none") {
    rewriter.recordManual(call, `r.${name}: missing argument`);
    return;
  }
  if (shape === "ambiguous") {
    rewriter.recordManual(
      call,
      `r.${name}: argument is not a string literal, so it may already be the options object, check by hand`,
    );
    return;
  }
  if (!isRegistrar) {
    rewriter.recordManual(call, `r.${name}: ${unresolvedWhy}`);
    return;
  }

  if (shape === "object") {
    const edit = renameTo === undefined ? undefined : renameOnlyEdit(call, renameTo);
    if (edit === undefined) return;
    rewriter.addEdit(edit);
    rewriter.recordRewrite(call, `r.${name}: renamed to r.${renameTo}`);
    dropHookBiomeIgnore(rewriter, call);
    return;
  }

  const plan = planPositional(rewriter, call, verb);
  applyPlan(rewriter, call, name, plan);
  if (renameTo !== undefined && !("why" in plan)) dropHookBiomeIgnore(rewriter, call);
}

function visitAll(rewriter: SourceRewriter, sourceFile: SourceFile): void {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    visitCall(rewriter, call);
  }
}

export function transformRegistrarSingleFormSource(
  source: string,
  filePath: string,
): CodemodResult {
  if (!CHEAP_PREFILTER.test(source)) return { output: source, rewrites: [], manual: [] };
  const project = parserProject();
  const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });
  const rewriter = new SourceRewriter(source, filePath);
  visitAll(rewriter, sourceFile);
  const output = rewriter.textOf(0, source.length);
  project.removeSourceFile(sourceFile);
  return { output, rewrites: rewriter.rewrites, manual: rewriter.manual };
}

function isSkippedPath(file: string): boolean {
  return (
    file.includes("/__tests__/fixtures/") ||
    file.endsWith("packages/feature-ast/src/scripts/codemod/registrar-single-form.ts") ||
    file.endsWith("packages/feature-ast/src/__tests__/registrar-single-form-codemod.test.ts")
  );
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "registrar-single-form",
      transform: transformRegistrarSingleFormSource,
      isSkippedPath,
    },
    process.argv.slice(2),
  );
}
