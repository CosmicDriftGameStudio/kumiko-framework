#!/usr/bin/env bun
// entity-name — an entity carries its name. The name moves from `r.entity({ name, ...entity })`,
// `r.crud("name", entity)`, `createEntityExecutor("name", entity)`, `buildEntityTable("name", entity)`
// and `deriveEntityTableMeta("name", entity)` into the entity's `createEntity({ name, ... })` call.
// An entity used under a second name becomes `{ ...entity, name: "other" }` at that site.
//
// Two passes over the project: the first collects the names per `createEntity` declaration through
// symbol resolution (also across files), the second writes `name` into the declaration and rewrites
// the call sites. Run it on a directory that holds both the entity declarations and their uses.
//
// Usage:
//   bun scripts/codemod/entity-name.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type CallExpression,
  type Identifier,
  Node,
  type ObjectLiteralExpression,
  type Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  type CodemodSite,
  runCodemodCli,
  type TextEdit,
} from "./codemod-support.ts";
import { collectSourceFiles } from "./collect-source-files.ts";
import { isUnresolvedRegistrarLookalike, resolveReceiver } from "./registrar-receiver.ts";
import { createTypeAwareProject } from "./type-aware-project.ts";

const CHEAP_PREFILTER =
  /\b(createEntity|createEntityExecutor|buildEntityTable|deriveEntityTableMeta|entity|crud)\b/;
const NAME_FIRST_FUNCTIONS: ReadonlySet<string> = new Set([
  "createEntityExecutor",
  "buildEntityTable",
  "deriveEntityTableMeta",
]);
const CREATE_ENTITY = "createEntity";
const BACKING_TABLE = "backingTable";

interface Usage {
  readonly call: CallExpression;
  readonly label: string;
  readonly name: string;
  readonly declaration: CallExpression;
  // Builds the replacement once the canonical name of the entity is known.
  readonly edit: (canonicalName: string) => TextEdit;
}

function isStringish(node: Node): boolean {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node);
}

function literalText(node: Node): string | undefined {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)
    ? node.getLiteralText()
    : undefined;
}

function quoted(name: string): string {
  return JSON.stringify(name);
}

function calleeNameOf(call: CallExpression): string | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
}

function isRegistrarCall(call: CallExpression): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression();
  return resolveReceiver(receiver) === "registrar" || isUnresolvedRegistrarLookalike(receiver);
}

// The createEntity call an identifier ends up at, through imports and re-exports.
function resolveEntityDeclaration(identifier: Identifier): CallExpression | undefined {
  let symbol = identifier.getSymbol();
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol();
  for (const declaration of symbol?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (
      initializer !== undefined &&
      Node.isCallExpression(initializer) &&
      calleeNameOf(initializer) === CREATE_ENTITY
    ) {
      return initializer;
    }
  }
  return undefined;
}

class Collector {
  readonly usages: Usage[] = [];
  readonly manual: CodemodSite[] = [];

  constructor(private readonly file: string) {}

  private fail(node: Node, description: string): void {
    this.manual.push({ file: this.file, line: node.getStartLineNumber(), description });
  }

  private resolve(
    call: CallExpression,
    label: string,
    entityArg: Node,
  ): { entity: Identifier; declaration: CallExpression } | undefined {
    if (!Node.isIdentifier(entityArg)) {
      this.fail(call, `${label}: entity argument is not a plain identifier, move the name by hand`);
      return undefined;
    }
    const declaration = resolveEntityDeclaration(entityArg);
    if (declaration === undefined) {
      this.fail(
        call,
        `${label}: \`${entityArg.getText()}\` does not resolve to a createEntity call, add name to the entity by hand`,
      );
      return undefined;
    }
    return { entity: entityArg, declaration };
  }

  // createEntityExecutor / buildEntityTable / deriveEntityTableMeta / r.crud
  collectPositional(call: CallExpression, label: string): void {
    const [nameArg, entityArg] = call.getArguments();
    if (nameArg === undefined || entityArg === undefined) return;
    const isOldForm =
      isStringish(nameArg) ||
      (Node.isIdentifier(entityArg) && resolveEntityDeclaration(entityArg) !== undefined);
    if (!isOldForm) return;
    const name = literalText(nameArg);
    if (name === undefined) {
      this.fail(call, `${label}: name is not a string literal, move the name by hand`);
      return;
    }
    const resolved = this.resolve(call, label, entityArg);
    if (resolved === undefined) return;
    const entityText = resolved.entity.getText();
    this.usages.push({
      call,
      label,
      name,
      declaration: resolved.declaration,
      edit: (canonicalName) =>
        canonicalName === name
          ? { start: nameArg.getStart(), end: entityArg.getStart(), text: "" }
          : {
              start: nameArg.getStart(),
              end: entityArg.getEnd(),
              text: `{ ...${entityText}, name: ${quoted(name)} }`,
            },
    });
  }

  // r.entity({ name: "x", ...xEntity [, backingTable] }); the new form spreads first.
  collectEntityCall(call: CallExpression): void {
    const label = "r.entity";
    const arg = call.getArguments()[0];
    if (arg === undefined || !Node.isObjectLiteralExpression(arg)) return;
    const members = arg.getProperties();
    const spreadIndex = members.findIndex((member) => Node.isSpreadAssignment(member));
    const nameIndex = members.findIndex(
      (member) => Node.isPropertyAssignment(member) && member.getName() === "name",
    );
    if (spreadIndex === -1 || nameIndex === -1 || nameIndex > spreadIndex) return;
    const nameMember = members[nameIndex];
    const spread = members[spreadIndex];
    if (!Node.isPropertyAssignment(nameMember) || !Node.isSpreadAssignment(spread)) return;
    const name = literalText(nameMember.getInitializer() ?? nameMember);
    if (name === undefined) {
      this.fail(call, `${label}: name is not a string literal, move the name by hand`);
      return;
    }
    const others = members.filter(
      (member) => member !== nameMember && member !== spread,
    );
    const backing = others.filter(
      (member) =>
        (Node.isPropertyAssignment(member) || Node.isShorthandPropertyAssignment(member)) &&
        member.getName() === BACKING_TABLE,
    );
    if (backing.length !== others.length || backing.length > 1) {
      this.fail(call, `${label}: the literal has properties besides name, entity and backingTable`);
      return;
    }
    const resolved = this.resolve(call, label, spread.getExpression());
    if (resolved === undefined) return;
    const entityText = resolved.entity.getText();
    const backingText = backing[0]?.getText();
    this.usages.push({
      call,
      label,
      name,
      declaration: resolved.declaration,
      edit: (canonicalName) => {
        const backingPart = backingText === undefined ? [] : [backingText];
        const parts =
          canonicalName === name
            ? backingPart
            : [`name: ${quoted(name)}`, ...backingPart];
        return {
          start: arg.getStart(),
          end: arg.getEnd(),
          text: parts.length === 0 ? entityText : `{ ...${entityText}, ${parts.join(", ")} }`,
        };
      },
    });
  }

  collect(sourceFile: SourceFile): void {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = calleeNameOf(call);
      if (name === undefined) continue;
      if (name === "entity" && isRegistrarCall(call)) this.collectEntityCall(call);
      else if (name === "crud" && isRegistrarCall(call)) this.collectPositional(call, "r.crud");
      else if (NAME_FIRST_FUNCTIONS.has(name)) this.collectPositional(call, name);
    }
  }
}

function entityLiteralOf(declaration: CallExpression): ObjectLiteralExpression | undefined {
  const arg = declaration.getArguments()[0];
  return arg !== undefined && Node.isObjectLiteralExpression(arg) ? arg : undefined;
}

function nameInsertion(literal: ObjectLiteralExpression, name: string): TextEdit {
  const first = literal.getProperties()[0];
  if (first === undefined) {
    return { start: literal.getStart(), end: literal.getEnd(), text: `{ name: ${quoted(name)} }` };
  }
  const text = literal.getSourceFile().getFullText();
  const lineStart = text.lastIndexOf("\n", first.getStart() - 1) + 1;
  const indent = text.slice(lineStart, first.getStart()).match(/^\s*/)?.[0] ?? "";
  const separator = literal.getText().includes("\n") ? `\n${indent}` : " ";
  return {
    start: first.getStart(),
    end: first.getStart(),
    text: `name: ${quoted(name)},${separator}`,
  };
}

interface FileResult {
  readonly edits: TextEdit[];
  readonly rewrites: CodemodSite[];
  readonly manual: CodemodSite[];
}

type FileResults = Map<string, FileResult>;

function resultsFor(results: FileResults, file: string): FileResult {
  const existing = results.get(file);
  if (existing !== undefined) return existing;
  const created: FileResult = { edits: [], rewrites: [], manual: [] };
  results.set(file, created);
  return created;
}

function groupByDeclaration(usages: readonly Usage[]): Map<string, Usage[]> {
  const groups = new Map<string, Usage[]>();
  for (const usage of usages) {
    const key = `${usage.declaration.getSourceFile().getFilePath()}:${usage.declaration.getStart()}`;
    const group = groups.get(key) ?? [];
    group.push(usage);
    groups.set(key, group);
  }
  return groups;
}

// Name already on the createEntity call, else the first name found for it.
function canonicalNameOf(
  literal: ObjectLiteralExpression,
  usages: readonly Usage[],
): { readonly name: string; readonly insert: boolean } | { readonly why: string } {
  const existing = literal.getProperty("name");
  if (existing === undefined) {
    const first = usages[0];
    return first === undefined ? { why: "no usage" } : { name: first.name, insert: true };
  }
  const value = Node.isPropertyAssignment(existing) ? existing.getInitializer() : undefined;
  const text = value === undefined ? undefined : literalText(value);
  return text === undefined
    ? { why: "the createEntity name is not a string literal, move the names by hand" }
    : { name: text, insert: false };
}

export function transformEntityNames(
  project: Project,
  filePaths: readonly string[],
): Map<string, CodemodResult> {
  const results: FileResults = new Map();
  const usages: Usage[] = [];
  for (const path of filePaths) {
    const sourceFile = project.getSourceFile(path);
    if (sourceFile === undefined) continue;
    const key = sourceFile.getFilePath();
    const collector = new Collector(key);
    collector.collect(sourceFile);
    usages.push(...collector.usages);
    resultsFor(results, key).manual.push(...collector.manual);
  }

  for (const group of groupByDeclaration(usages).values()) {
    const [first] = group;
    if (first === undefined) continue;
    const declaration = first.declaration;
    const declarationFile = declaration.getSourceFile().getFilePath();
    const literal = entityLiteralOf(declaration);
    const canonical = literal === undefined ? undefined : canonicalNameOf(literal, group);
    if (literal === undefined || canonical === undefined || "why" in canonical) {
      const why =
        canonical !== undefined && "why" in canonical
          ? canonical.why
          : "the createEntity argument is not an object literal, add name by hand";
      for (const usage of group) {
        const file = usage.call.getSourceFile().getFilePath();
        resultsFor(results, file).manual.push({
          file,
          line: usage.call.getStartLineNumber(),
          description: `${usage.label}: ${why}`,
        });
      }
      continue;
    }
    if (canonical.insert) {
      const target = resultsFor(results, declarationFile);
      target.edits.push(nameInsertion(literal, canonical.name));
      target.rewrites.push({
        file: declarationFile,
        line: declaration.getStartLineNumber(),
        description: `createEntity: name ${quoted(canonical.name)} added`,
      });
    }
    for (const usage of group) {
      const file = usage.call.getSourceFile().getFilePath();
      const target = resultsFor(results, file);
      target.edits.push(usage.edit(canonical.name));
      target.rewrites.push({
        file,
        line: usage.call.getStartLineNumber(),
        description:
          usage.name === canonical.name
            ? `${usage.label}: name argument dropped`
            : `${usage.label}: second name ${quoted(usage.name)} spread onto the entity`,
      });
    }
  }

  const output = new Map<string, CodemodResult>();
  for (const [file, { edits, rewrites, manual }] of results) {
    const source = project.getSourceFile(file)?.getFullText() ?? "";
    output.set(file, { output: applyEdits(source, edits), rewrites, manual });
  }
  return output;
}

const analysisByRoot = new Map<string, Map<string, CodemodResult>>();

function analyseRoot(projectRoot: string): Map<string, CodemodResult> {
  const cached = analysisByRoot.get(projectRoot);
  if (cached !== undefined) return cached;
  const tsconfig = join(projectRoot, "tsconfig.json");
  const project = createTypeAwareProject(existsSync(tsconfig) ? tsconfig : undefined);
  const files = collectSourceFiles([projectRoot], {
    isMigratableFile: (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"),
  }).filter((file) => !file.includes("/__tests__/fixtures/"));
  for (const file of files) project.addSourceFileAtPath(file);
  const analysed = transformEntityNames(project, files);
  analysisByRoot.set(projectRoot, analysed);
  return analysed;
}

// The analysis spans the whole project root, so edits to an entity declaration reach files outside
// the directory that was passed in only when that directory covers them.
export function transformEntityNameSource(
  source: string,
  filePath: string,
  projectRoot: string,
): CodemodResult {
  if (!CHEAP_PREFILTER.test(source)) return { output: source, rewrites: [], manual: [] };
  const found = analyseRoot(projectRoot).get(resolve(filePath));
  return found ?? { output: source, rewrites: [], manual: [] };
}

function isSkippedPath(file: string): boolean {
  return (
    file.includes("/__tests__/fixtures/") ||
    file.endsWith("packages/feature-ast/src/scripts/codemod/entity-name.ts") ||
    file.endsWith("packages/feature-ast/src/__tests__/entity-name-codemod.test.ts")
  );
}

if (import.meta.main) {
  await runCodemodCli(
    { name: "entity-name", transform: transformEntityNameSource, isSkippedPath },
    process.argv.slice(2),
  );
}
