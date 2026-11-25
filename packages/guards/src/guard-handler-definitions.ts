#!/usr/bin/env bun
/**
 * Handler Definitions Guard — counts handler definitions that break the one-handler-per-file layout under `handlers/` or erase their payload type, frozen per file in `.kumiko-handler-definitions-baseline.json`.
 *
 * Inside a feature (`src/features/<f>/`, `bundled-features/src/<f>/`) a handler definition lives
 * in `handlers/<topic>.write.ts` or `handlers/<topic>.query.ts`, one per file, and the suffix
 * matches the handler kind. Everywhere, an object literal typed `WriteHandlerDef` or
 * `QueryHandlerDef` counts: it types the payload as `unknown`. A missing baseline file counts
 * as empty, so every existing hit fails until it is frozen with `--write-baseline`.
 */

import path from "node:path";
import {
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { fileIgnoreTagLine, hasIgnoreTag } from "./_lib/ignore-tag";
import { resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/bundled-features/src/**", "samples/**/src/**"],
};

const IGNORE_SLUG = "handler-definitions";
const IGNORE_TAG = `kumiko-lint-ignore ${IGNORE_SLUG}`;
const TEST_PATH = /(?:(?:^|\/)__tests__\/)|(?:\.(?:test|integration|e2e|spec)\.[tj]sx?$)/;
const FEATURE_LOCATION =
  /(?:^|\/)(?:src\/features\/[^/]+|packages\/bundled-features\/src\/[^/]+)\/(.+)$/;
const HANDLERS_DIR_PREFIX = "handlers/";
const WRITE_FILE = /\.write\.tsx?$/;
const QUERY_FILE = /\.query\.tsx?$/;
const ERASED_TYPES: ReadonlySet<string> = new Set(["WriteHandlerDef", "QueryHandlerDef"]);

type HandlerKind = "write" | "query";

// Maps, not object literals: an arbitrary callee name such as `toString` must not hit Object.prototype.
const FACTORY_KIND: ReadonlyMap<string, HandlerKind> = new Map([
  ["defineWriteHandler", "write"],
  ["defineQueryHandler", "query"],
  ["definePagedQueryHandler", "query"],
]);
const INLINE_KIND: ReadonlyMap<string, HandlerKind> = new Map([
  ["writeHandler", "write"],
  ["queryHandler", "query"],
]);

const handlerDefinitionsBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-handler-definitions-baseline.json"),
  formatVersion: 1,
  unit: "handler definition finding(s)",
});

interface HandlerDefinition {
  readonly node: Node;
  readonly kind: HandlerKind;
}

function calleeName(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
}

function handlerDefinitionsOf(sf: SourceFile): HandlerDefinition[] {
  const found: HandlerDefinition[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call);
    if (name === undefined) continue;
    const factoryKind = FACTORY_KIND.get(name);
    if (factoryKind !== undefined) {
      found.push({ node: call, kind: factoryKind });
      continue;
    }
    const inlineKind = INLINE_KIND.get(name);
    if (inlineKind !== undefined && Node.isObjectLiteralExpression(call.getArguments()[0])) {
      found.push({ node: call, kind: inlineKind });
    }
  }
  return found;
}

function unwrapExpression(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current !== undefined &&
    (Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

function isErasedTypeText(typeNode: Node | undefined): boolean {
  return typeNode !== undefined && ERASED_TYPES.has(typeNode.getText());
}

type FunctionLike = FunctionDeclaration | ArrowFunction | MethodDeclaration | FunctionExpression;

function isFunctionLike(node: Node): node is FunctionLike {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isFunctionExpression(node)
  );
}

// Each entry is the literal plus the node an ignore marker may sit on.
function erasedLiteralsOf(sf: SourceFile): Map<Node, Node> {
  const literals = new Map<Node, Node>();
  const add = (candidate: Node | undefined, anchor: Node): void => {
    const literal = unwrapExpression(candidate);
    if (literal !== undefined && Node.isObjectLiteralExpression(literal)) {
      literals.set(literal, anchor);
    }
  };

  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (isErasedTypeText(decl.getTypeNode())) add(decl.getInitializer(), decl);
  }
  for (const expr of [
    ...sf.getDescendantsOfKind(SyntaxKind.SatisfiesExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.AsExpression),
  ]) {
    if (isErasedTypeText(expr.getTypeNode())) add(expr.getExpression(), expr);
  }
  for (const fn of sf.getDescendants().filter(isFunctionLike)) {
    if (!isErasedTypeText(fn.getReturnTypeNode())) continue;
    if (Node.isArrowFunction(fn)) add(fn.getBody(), fn);
    for (const ret of fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      if (ret.getFirstAncestor(isFunctionLike) === fn) add(ret.getExpression(), ret);
    }
  }
  return literals;
}

function featureRelativePath(repoRel: string): string | undefined {
  return FEATURE_LOCATION.exec(repoRel)?.[1];
}

function layoutFindingCount(definitions: readonly HandlerDefinition[], featureRel: string): number {
  let count = 0;
  const underHandlers = featureRel.startsWith(HANDLERS_DIR_PREFIX);
  const isWriteFile = WRITE_FILE.test(featureRel);
  const isQueryFile = QUERY_FILE.test(featureRel);
  definitions.forEach((definition, index) => {
    if (hasIgnoreTag(definition.node, IGNORE_TAG)) return;
    if (!underHandlers) count += 1;
    if (index > 0) count += 1;
    if (isWriteFile && definition.kind === "query") count += 1;
    if (isQueryFile && definition.kind === "write") count += 1;
    if (index === 0 && underHandlers && !isWriteFile && !isQueryFile) count += 1;
  });
  return count;
}

export function handlerDefinitionFindings(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sf of files) {
    if (TEST_PATH.test(sf.getFilePath())) continue;
    if (fileIgnoreTagLine(sf, IGNORE_SLUG) !== undefined) continue;
    const repoRel = relFromRepoRoot(sf.getFilePath(), roots);
    const featureRel = featureRelativePath(repoRel);

    let count = 0;
    if (featureRel !== undefined) {
      count += layoutFindingCount(handlerDefinitionsOf(sf), featureRel);
    }
    for (const [literal, anchor] of erasedLiteralsOf(sf)) {
      if (!hasIgnoreTag(literal, IGNORE_TAG) && !hasIgnoreTag(anchor, IGNORE_TAG)) count += 1;
    }
    if (count > 0) counts[repoRel] = count;
  }
  return counts;
}

function localOnly(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([file]) => isLocalFinding({ file })));
}

const REMEDIATION = `Put one handler per file under \`<feature>/handlers/\`, named \`<topic>.write.ts\` / \`<topic>.query.ts\`; feature.ts only registers the imported handlers.
Build handlers with defineWriteHandler / defineQueryHandler instead of a literal typed WriteHandlerDef / QueryHandlerDef (that literal types the payload as unknown).
Root-level \`<name>.write.ts\` / \`<name>.query.ts\` move with \`bun kumiko codemod feature-layout . --write\`.`;

export const guard: AstGuard = {
  name: "Handler Definitions",
  ignoreTag: IGNORE_TAG,
  scan: SCAN,
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="Handler Definitions"`',
  run: (files, roots = resolveRepoRoots()) => {
    const counts = localOnly(handlerDefinitionFindings(files, roots));
    return {
      violations: handlerDefinitionsBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="Handler Definitions"\` once.`,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    handlerDefinitionsBaseline.write(localOnly(handlerDefinitionFindings(files, roots)));
  },
};

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    guard.writeBaseline?.(filesForGuard(project, guard));
    process.exit(0);
  }
  runStandalone(guard);
}
