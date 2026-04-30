// scanEvents — finds every `r.defineEvent(...)` call across the app's
// feature files and resolves both the event-name (string literal) AND
// the schema source needed to derive a TS-Type. The codegen pipeline
// turns these into a `KumikoEventTypeMap` augmentation, the "single
// source of truth" the local defineWriteHandler-wrapper binds against
// for cross-package strict-checking.
//
// Output is a flat list of "event entries" — qualified-name + everything
// needed to emit a `z.infer<typeof Schema>` line in the augmentation.
//
// Patterns we resolve to a strict-checked type:
//   1. r.defineEvent("name", schemaIdentifier)
//      Position-form, named import. The cleanest case — Schema lives
//      in events.ts, gets re-imported by the augmentation as `import
//      type` and threaded through `z.infer<typeof Schema>`.
//
//   2. r.defineEvent({ name, schema })
//      Object-form, otherwise identical to (1).
//
//   3. r.defineEvent(NAME_CONST.member, schema...)
//      Computed name via `as const` object. We follow the property-
//      access through ts-morph's symbol-resolver, find the literal
//      member, treat it as the string from (1)/(2). Keeps recipes that
//      centralise event-names in a constants module strict-able.
//
//   4. r.defineEvent(name..., z.object({ ... }))
//      Inline schema (call-expression instead of an identifier). We
//      extract the call-source-text and emit it into a co-generated
//      `schemas.generated.ts` as a named `export const`, then point
//      the augmentation at that named export. The original feature
//      file keeps its inline schema for runtime validation; the
//      generated schemas-file exists ONLY for type-inference (consumed
//      via `import type`, erased at build).
//
// What we still skip with a warning:
//   - Default- or namespace-imports of the schema identifier
//     (`import S from "..."`, `import * as M from "..."`). Rare in
//     real apps; signal-to-noise of supporting them isn't worth it.
//   - Computed names whose const cannot be statically resolved
//     (cross-package re-exports, dynamic property access).

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  type CallExpression,
  type ImportDeclaration,
  type Node,
  Project,
  type PropertyAccessExpression,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

/**
 * Replicates `packages/framework/src/engine/qualified-name.ts:toKebab`.
 * Frame's r.defineEvent runs the feature-name + event-name through this
 * helper before joining them — `defineFeature("driverOrders")` writes
 * events under `driver-orders:event:...`. We MUST mirror the same
 * transform here, otherwise the augmentation key drifts from the
 * runtime event-type and strict-mode would catch a phantom mismatch.
 *
 * Inlined (instead of imported from framework) to keep the codegen
 * package boundary clean — codegen doesn't depend on the runtime
 * framework, only the framework-source-tree via paths-mapping at the
 * caller's compile.
 */
function toKebab(input: string): string {
  return input
    .replace(/\./g, "-")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

export type ScannedEvent = {
  /** Qualified event-name as it appears in the events table:
   *  `<feature>:event:<inner>`. The KumikoEventTypeMap key. */
  readonly qualifiedName: string;
  /** Where the type for this event's payload comes from. Two flavours:
   *
   *    { kind: "imported", schemaIdentifier, schemaModulePath }
   *      Schema is a named export of another file. Augmentation
   *      `import type`-s it from there.
   *
   *    { kind: "inline", schemaSource, generatedConstName }
   *      Schema was inlined at the call-site. We extract the source
   *      text into `schemas.generated.ts` under `generatedConstName`
   *      and import-type from there. */
  readonly schemaSource: SchemaSource;
  /** Absolute disk-path of the feature file (for relative-path
   *  resolution + diagnostics). */
  readonly featureFilePath: string;
  /** For diagnostics + dedup logging. */
  readonly source: { readonly file: string; readonly line: number };
};

export type SchemaSource =
  | {
      readonly kind: "imported";
      readonly schemaIdentifier: string;
      readonly schemaModulePath: string;
    }
  | {
      readonly kind: "inline";
      /** zod source text — `z.object({ id: z.string() })` etc. */
      readonly schemaSource: string;
      /** Name we'll generate inside `schemas.generated.ts`. Stable
       *  + qualified-name-derived so reorder of features doesn't
       *  rename them. */
      readonly generatedConstName: string;
    };

export type ScanWarning = {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
};

export type ScanResult = {
  readonly events: readonly ScannedEvent[];
  readonly warnings: readonly ScanWarning[];
};

export type ScanOptions = {
  /** App-Wurzel — alles unter `<root>/src` wird gescannt. Tests +
   *  generated-files (`.kumiko`, `dist*`, `node_modules`) sind raus. */
  readonly appRoot: string;
};

/**
 * Scant `appRoot/src/**` nach `r.defineEvent(...)`-Aufrufen und liefert
 * eine deduplizierte Liste aus ScannedEvent. Doppelte qualifiedName
 * landen mit einer Warnung in der Result — Codegen schreibt nur den
 * ERSTEN, sodass das generated File compile-stabil bleibt.
 */
export function scanEvents(opts: ScanOptions): ScanResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  const filesToScan: string[] = [];
  collectTsFiles(join(opts.appRoot, "src"), filesToScan);

  // Add ALL files to the project up-front. ts-morph's symbol-resolver
  // needs to see the file that declares the const-object before it can
  // follow `INVOICE_EVENTS.sent` to its string literal.
  for (const filePath of filesToScan) {
    project.addSourceFileAtPath(filePath);
  }

  const events: ScannedEvent[] = [];
  const warnings: ScanWarning[] = [];

  for (const filePath of filesToScan) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) continue;
    scanFile(sourceFile, filePath, events, warnings);
  }

  return { events: dedupe(events, warnings), warnings };
}

// ============================================================================
// Internal — directory walk
// ============================================================================

const SKIP_SEGMENTS = new Set([
  "node_modules",
  ".kumiko",
  "dist",
  "dist-server",
  "__tests__",
]);

function collectTsFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory missing — fine, just no files to scan there.
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_SEGMENTS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      collectTsFiles(full, out);
    } else if (
      stat.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
}

// ============================================================================
// Internal — per-file scan
// ============================================================================

function scanFile(
  sourceFile: SourceFile,
  filePath: string,
  events: ScannedEvent[],
  warnings: ScanWarning[],
): void {
  // Find every defineFeature(...) — there may be multiple in factory-style
  // packages (one factory function per feature). Each carries its own
  // featureName (1st arg) + setup-arrow-function (2nd arg).
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "defineFeature") continue;
    const featureName = readStringLiteral(call.getArguments()[0]);
    if (!featureName) continue;
    const setup = call.getArguments()[1]?.asKind(SyntaxKind.ArrowFunction);
    if (!setup) continue;
    const registrarParam = setup.getParameters()[0]?.getName();
    if (!registrarParam) continue;
    for (const defCall of setup.getBody().getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = defCall.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
      if (!expr) continue;
      if (expr.getExpression().getText() !== registrarParam) continue;
      if (expr.getName() !== "defineEvent") continue;

      collectFromDefineEvent(defCall, sourceFile, featureName, filePath, events, warnings);
    }
  }
}

function collectFromDefineEvent(
  call: CallExpression,
  sourceFile: SourceFile,
  featureName: string,
  filePath: string,
  events: ScannedEvent[],
  warnings: ScanWarning[],
): void {
  const parsed = parseDefineEventCall(call);
  if (!parsed) {
    warnings.push({
      file: filePath,
      line: call.getStartLineNumber(),
      reason: "r.defineEvent: cannot read event-name + schema statically",
    });
    return;
  }

  // Mirror the framework's `qn(toKebab(feature), "event", toKebab(name))`
  // — the augmentation key MUST match what `r.defineEvent` writes at
  // runtime. Without the kebab-step, `defineFeature("driverOrders")`
  // would augment `driverOrders:event:*` while the runtime stream
  // carries `driver-orders:event:*`, and strict-mode would reject every
  // correct call.
  const qualifiedName = `${toKebab(featureName)}:event:${toKebab(parsed.eventName)}`;
  const schema = resolveSchemaSource(
    parsed.schemaNode,
    sourceFile,
    qualifiedName,
  );
  if (!schema) {
    warnings.push({
      file: filePath,
      line: call.getStartLineNumber(),
      reason: `r.defineEvent("${parsed.eventName}"): schema "${parsed.schemaNode.getText()}" — not a named import nor an inline z.* call, skipped`,
    });
    return;
  }

  events.push({
    qualifiedName,
    schemaSource: schema,
    featureFilePath: filePath,
    source: { file: filePath, line: call.getStartLineNumber() },
  });
}

// ============================================================================
// Internal — extract event-name + schema-node
// ============================================================================

type ParsedDefineEvent = {
  /** Final `<inner>` part of the qualified name. Always a string-literal
   *  AFTER resolution (we follow PropertyAccess → const-member). */
  readonly eventName: string;
  /** AST node for the schema argument — left to be resolved by
   *  resolveSchemaSource into either an imported-named or inline-call. */
  readonly schemaNode: Node;
};

function parseDefineEventCall(call: CallExpression): ParsedDefineEvent | undefined {
  const args = call.getArguments();
  const first = args[0];
  if (!first) return undefined;

  // Object-form: r.defineEvent({ name, schema, version? })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameProp = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const eventName = nameProp ? resolveStringLiteralOrConst(nameProp) : undefined;
    if (!eventName) return undefined;
    const schemaNode = obj
      .getProperty("schema")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!schemaNode) return undefined;
    return { eventName, schemaNode };
  }

  // Position-form: r.defineEvent(<name-source>, <schema-node>, ...)
  const eventName = resolveStringLiteralOrConst(first);
  const schemaNode = args[1];
  if (!eventName || !schemaNode) return undefined;
  return { eventName, schemaNode };
}

/**
 * Resolves a node to a string literal — either it IS a string-literal,
 * or it's a property-access on a `const X = { ... } as const` object
 * whose member resolves to one. Returns undefined for anything else
 * (template literals, dynamic property access, function calls).
 *
 * Cross-file resolution: we follow the named import that brings the
 * receiver-identifier into scope, load the target file from the same
 * ts-morph project, and look up the const-declaration there. This
 * works WITHOUT a TypeChecker — the import-graph + AST is enough for
 * the patterns the recipes/showcases use (`as const` objects with
 * string-literal members).
 */
function resolveStringLiteralOrConst(node: Node): string | undefined {
  // Direct string-literal — fast path.
  const direct = node.asKind(SyntaxKind.StringLiteral);
  if (direct) return direct.getLiteralValue();

  // PropertyAccessExpression: `INVOICE_EVENTS.sent` form.
  const propAccess = node.asKind(SyntaxKind.PropertyAccessExpression);
  if (propAccess) return resolvePropertyAccessLiteral(propAccess);

  return undefined;
}

function resolvePropertyAccessLiteral(
  propAccess: PropertyAccessExpression,
): string | undefined {
  const receiver = propAccess.getExpression().asKind(SyntaxKind.Identifier);
  if (!receiver) return undefined;
  const memberName = propAccess.getName();
  const callerFile = propAccess.getSourceFile();

  // Two paths to find the const-declaration:
  //   1. Local: declared in the same file before the call.
  //   2. Imported: a named import points at another file in the project;
  //      the const lives there as an `export const`.
  const local = findConstObject(callerFile, receiver.getText());
  if (local) return readMemberLiteral(local, memberName);

  for (const importDecl of callerFile.getImportDeclarations()) {
    if (!matchesNamedImport(importDecl, receiver.getText())) continue;
    const targetFile = resolveImportedSourceFile(importDecl, callerFile);
    if (!targetFile) continue;
    const remote = findConstObject(targetFile, receiver.getText());
    if (remote) {
      const literal = readMemberLiteral(remote, memberName);
      if (literal !== undefined) return literal;
    }
  }
  return undefined;
}

/**
 * Walk top-level statements for `const RECEIVER = { ... } [as const]`.
 * Returns the inner object-literal if found.
 */
function findConstObject(
  sourceFile: SourceFile,
  receiverName: string,
): Node | undefined {
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() !== receiverName) continue;
      const init = unwrapAsConst(decl.getInitializer());
      const objLit = init?.asKind(SyntaxKind.ObjectLiteralExpression);
      if (objLit) return objLit;
    }
  }
  return undefined;
}

function readMemberLiteral(
  objLitNode: Node,
  memberName: string,
): string | undefined {
  const objLit = objLitNode.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!objLit) return undefined;
  const prop = objLit.getProperty(memberName)?.asKind(SyntaxKind.PropertyAssignment);
  const initLit = prop?.getInitializer()?.asKind(SyntaxKind.StringLiteral);
  return initLit?.getLiteralValue();
}

/**
 * Resolve a relative import-specifier to a SourceFile already loaded
 * in the project. Tries `<base>.ts` and `<base>/index.ts`. Returns
 * undefined for npm-package specifiers (no local resolution needed —
 * we don't follow anything beyond the app's own files).
 */
function resolveImportedSourceFile(
  importDecl: ImportDeclaration,
  fromFile: SourceFile,
): SourceFile | undefined {
  const spec = importDecl.getModuleSpecifierValue();
  if (!spec.startsWith(".")) return undefined;
  const fromDir = fromFile.getDirectoryPath();
  const project = fromFile.getProject();
  const candidates = [
    `${spec}.ts`,
    `${spec}.tsx`,
    `${spec}/index.ts`,
    `${spec}/index.tsx`,
  ];
  for (const cand of candidates) {
    const abs = resolve(fromDir, cand);
    const sf = project.getSourceFile(abs);
    if (sf) return sf;
  }
  return undefined;
}

/**
 * `{ x: 1 } as const` parses as `AsExpression > ObjectLiteralExpression`.
 * Strip the AsExpression so the caller can hit the inner literal directly.
 */
function unwrapAsConst(node: Node | undefined): Node | undefined {
  if (!node) return undefined;
  const asExpr = node.asKind(SyntaxKind.AsExpression);
  return asExpr ? asExpr.getExpression() : node;
}

function readStringLiteral(node: Node | undefined): string | undefined {
  return node?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
}

// ============================================================================
// Internal — resolve schema node to its source kind
// ============================================================================

function resolveSchemaSource(
  schemaNode: Node,
  sourceFile: SourceFile,
  qualifiedName: string,
): SchemaSource | undefined {
  // Named identifier: schema lives in another file as a named export.
  const ident = schemaNode.asKind(SyntaxKind.Identifier);
  if (ident) {
    const importInfo = resolveSchemaImport(sourceFile, ident.getText());
    if (!importInfo) return undefined;
    return {
      kind: "imported",
      schemaIdentifier: ident.getText(),
      schemaModulePath: importInfo.moduleSpecifier,
    };
  }

  // Inline call: r.defineEvent("name", z.object({...})).
  // We accept any call-expression that LOOKS like a zod schema (cheap
  // structural check on the `z.*` head). The exact ".object/.string/etc"
  // doesn't matter — the codegen will replay the source text in the
  // schemas-file, where TS resolves z.infer correctly.
  const callExpr = schemaNode.asKind(SyntaxKind.CallExpression);
  if (callExpr && looksLikeZodCall(callExpr)) {
    return {
      kind: "inline",
      schemaSource: callExpr.getText(),
      generatedConstName: qualifiedNameToConstName(qualifiedName),
    };
  }

  return undefined;
}

function looksLikeZodCall(call: CallExpression): boolean {
  // Walk the callee head — `z.something(...)` or `z.something.foo(...)`,
  // anything that traces back to an Identifier `z`. Conservative: we
  // don't try to verify it's the actual zod-import (the runtime check
  // happens through the schemas-file's `import { z } from "zod"` anyway,
  // which fails loudly if the user's `z` is something else).
  let cur: Node = call.getExpression();
  while (cur.asKind(SyntaxKind.PropertyAccessExpression) || cur.asKind(SyntaxKind.CallExpression)) {
    const prop = cur.asKind(SyntaxKind.PropertyAccessExpression);
    if (prop) {
      cur = prop.getExpression();
      continue;
    }
    const innerCall = cur.asKind(SyntaxKind.CallExpression);
    if (innerCall) {
      cur = innerCall.getExpression();
      continue;
    }
  }
  return cur.asKind(SyntaxKind.Identifier)?.getText() === "z";
}

function resolveSchemaImport(
  sourceFile: SourceFile,
  identifier: string,
): { readonly moduleSpecifier: string } | undefined {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    if (matchesNamedImport(importDecl, identifier)) {
      return { moduleSpecifier: importDecl.getModuleSpecifierValue() };
    }
  }
  return undefined;
}

function matchesNamedImport(importDecl: ImportDeclaration, identifier: string): boolean {
  for (const named of importDecl.getNamedImports()) {
    // Handles both `import { x }` and `import { x as y }` — we want the
    // LOCAL alias (what's used in the call site), which matches the
    // identifier the scanner extracted.
    const localName = named.getAliasNode()?.getText() ?? named.getNameNode().getText();
    if (localName === identifier) return true;
  }
  return false;
}

/**
 * Stable identifier-safe rewrite of a qualifiedName like
 * `pubsubOrders:event:order-placed` → `_kg_pubsubOrders__orderPlaced`.
 * Used for the `export const` name in `schemas.generated.ts`. Same
 * transform in scan + render keeps the two sides in sync.
 */
export function qualifiedNameToConstName(qualifiedName: string): string {
  // Drop the ":event:" infix — every entry has it, no information.
  const withoutEventInfix = qualifiedName.replace(/:event:/g, "__");
  // Replace remaining colons + dashes with `_` and camel-case after `_`
  // so the output is identifier-legal AND visually parseable.
  const sanitised = withoutEventInfix
    .replace(/[^A-Za-z0-9_]+(.?)/g, (_match, next: string) => next.toUpperCase());
  return `_kg_${sanitised}`;
}

// ============================================================================
// Internal — module-specifier rewriting + dedup
// ============================================================================

/**
 * Resolves the relative schema-import path from the feature-file's
 * point-of-view to a path relative to `.kumiko/` (which is where the
 * generated d.ts file lives). Workspace-package specifiers
 * (`@kumiko/...`) are returned as-is.
 */
export function rewriteImportPath(
  schemaModulePath: string,
  featureFilePath: string,
  outputDirAbs: string,
): string {
  // Workspace / npm specifiers — pass through. Codegen output imports
  // them by name.
  if (!schemaModulePath.startsWith(".")) return schemaModulePath;

  const featureDir = featureFilePath.substring(0, featureFilePath.lastIndexOf(sep));
  const absoluteSchemaPath = resolve(featureDir, schemaModulePath);
  const fromOutput = relative(outputDirAbs, absoluteSchemaPath);
  // POSIX-Slash für TS-imports (auch auf Windows).
  const normalised = fromOutput.split(sep).join("/");
  // Strip .ts/.tsx — TS module specifiers don't carry the extension;
  // resolve() didn't add one but a hand-written ".ts" should be removed.
  return normalised.replace(/\.tsx?$/, "");
}

function dedupe(events: ScannedEvent[], warnings: ScanWarning[]): ScannedEvent[] {
  const seen = new Map<string, ScannedEvent>();
  for (const ev of events) {
    const existing = seen.get(ev.qualifiedName);
    if (existing) {
      warnings.push({
        file: ev.source.file,
        line: ev.source.line,
        reason: `duplicate r.defineEvent("${ev.qualifiedName}") — first declared at ${existing.source.file}:${existing.source.line}, ignored here`,
      });
      continue;
    }
    seen.set(ev.qualifiedName, ev);
  }
  return [...seen.values()];
}
