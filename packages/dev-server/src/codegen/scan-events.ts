// scanEvents — finds every `r.defineEvent(...)` call across the app's
// feature files and resolves the schema's import-path. The codegen
// pipeline turns these into a `KumikoEventTypeMap` augmentation, the
// "single source of truth" the local defineWriteHandler-wrapper binds
// against for cross-package strict-checking.
//
// Output is a flat list of "event entries" — qualified-name + how to
// reach the schema-type from the generated `.kumiko/` directory.
//
// What this scanner DOES handle:
//   - Position-form:  r.defineEvent("toggle-set", featureToggleSetSchema);
//   - Object-form:    r.defineEvent({ name: "toggle-set", schema: featureToggleSetSchema });
//   - Schema-identifier resolved through *named* imports of the file
//     where the defineEvent lives (covers ~all real-world cases).
//
// What it does NOT handle (intentionally, with a soft-skip):
//   - Schemas defined inline (no identifier to import) — we'd have to
//     reconstruct the literal at codegen-time. Rare in practice; skip
//     with a warning lets the user keep coding.
//   - Schemas from default-imports / namespace-imports / dynamic imports.
//   - Computed/dynamic event names. The qualified name must be a
//     literal — both r.defineEvent and the runtime registry require it.

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  type ArrowFunction,
  type CallExpression,
  type ImportDeclaration,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

export type ScannedEvent = {
  /** Vollqualifizierter Event-Name wie er im events-table als `type`
   *  steht: `<feature>:event:<inner>`. Direkter Map-Key in der
   *  generierten KumikoEventTypeMap-Augmentation. */
  readonly qualifiedName: string;
  /** Variablen-Identifier des Zod-Schemas (das im r.defineEvent als 2.
   *  Argument bzw. `schema:`-Property steht). Wird so im Augmentation-
   *  File importiert + via `z.infer<typeof X>` gemappt. */
  readonly schemaIdentifier: string;
  /** Module-Specifier des Schema-Identifiers, AUS SICHT DES SCANNENDEN
   *  FEATURE-FILES. Wir resolven ihn unten zur absoluten Disk-Position
   *  und rendern relativ zum Output-Verzeichnis (.kumiko/). */
  readonly schemaModulePath: string;
  /** Absoluter Disk-Pfad des feature-Files, in dem dieser
   *  r.defineEvent steht. Brauchen wir um schemaModulePath relativ
   *  aufzulösen. */
  readonly featureFilePath: string;
  /** Source-File-Extension-stripped path (für rendering). */
  readonly source: { readonly file: string; readonly line: number };
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
   *  generated-files (`.kumiko`, `dist*`, `node_modules`) werden
   *  ausgeschlossen. */
  readonly appRoot: string;
  /** Zusätzliche Pfade die ZUSÄTZLICH gescannt werden. Damit kann der
   *  Codegen z.B. die bundled-features mitziehen, ohne dass die App
   *  sie unter src/ haben muss. Pfade absolut. */
  readonly extraScanPaths?: readonly string[];
};

/**
 * Scant `appRoot/src/**` (und `extraScanPaths/**`) nach
 * `r.defineEvent(...)` Aufrufen und liefert eine deduplizierte Liste
 * aus ScannedEvent. Doppelte qualifiedName landen mit einer Warnung in
 * der Result — Codegen schreibt nur den ERSTEN, sodass das generated
 * File compile-stabil bleibt.
 */
export function scanEvents(opts: ScanOptions): ScanResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  const events: ScannedEvent[] = [];
  const warnings: ScanWarning[] = [];

  const filesToScan: string[] = [];
  const srcDir = join(opts.appRoot, "src");
  collectTsFiles(srcDir, filesToScan);
  for (const extra of opts.extraScanPaths ?? []) {
    collectTsFiles(extra, filesToScan);
  }

  for (const filePath of filesToScan) {
    const sourceFile = project.addSourceFileAtPath(filePath);
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
    if (entry.startsWith(".") && entry !== ".") continue;
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
    scanSetupCallback(setup, featureName, sourceFile, filePath, events, warnings);
  }
}

function scanSetupCallback(
  setup: ArrowFunction,
  featureName: string,
  sourceFile: SourceFile,
  filePath: string,
  events: ScannedEvent[],
  warnings: ScanWarning[],
): void {
  const registrarParam = setup.getParameters()[0]?.getName();
  if (!registrarParam) return;
  for (const call of setup.getBody().getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    if (!expr) continue;
    if (expr.getExpression().getText() !== registrarParam) continue;
    if (expr.getName() !== "defineEvent") continue;

    const parsed = parseDefineEventCall(call);
    if (!parsed) {
      warnings.push({
        file: filePath,
        line: call.getStartLineNumber(),
        reason: "r.defineEvent: cannot read event-name + schema statically",
      });
      continue;
    }

    const importInfo = resolveSchemaImport(sourceFile, parsed.schemaIdentifier);
    if (!importInfo) {
      // Schema lives in the same file (no import needed) OR is from
      // default/namespace import. Same-file is supportable but rare; we
      // skip both with a warning so the user can move the schema into
      // its own file if they want strict-checking for it.
      warnings.push({
        file: filePath,
        line: call.getStartLineNumber(),
        reason: `r.defineEvent("${parsed.eventName}"): schema "${parsed.schemaIdentifier}" not found via named import — skipped`,
      });
      continue;
    }

    events.push({
      qualifiedName: `${featureName}:event:${parsed.eventName}`,
      schemaIdentifier: parsed.schemaIdentifier,
      schemaModulePath: importInfo.moduleSpecifier,
      featureFilePath: filePath,
      source: { file: filePath, line: call.getStartLineNumber() },
    });
  }
}

// ============================================================================
// Internal — extract event-name + schema-identifier
// ============================================================================

type ParsedDefineEvent = {
  readonly eventName: string;
  readonly schemaIdentifier: string;
};

function parseDefineEventCall(call: CallExpression): ParsedDefineEvent | undefined {
  const args = call.getArguments();
  const first = args[0];
  if (!first) return undefined;

  // Object-form: r.defineEvent({ name, schema, version? })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameLit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameLit) return undefined;
    const schemaInit = obj
      .getProperty("schema")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.Identifier);
    if (!schemaInit) return undefined;
    return {
      eventName: nameLit.getLiteralValue(),
      schemaIdentifier: schemaInit.getText(),
    };
  }

  // Position-form: r.defineEvent("name", schemaIdentifier)
  const nameLit = first.asKind(SyntaxKind.StringLiteral);
  const schemaIdent = args[1]?.asKind(SyntaxKind.Identifier);
  if (!nameLit || !schemaIdent) return undefined;
  return {
    eventName: nameLit.getLiteralValue(),
    schemaIdentifier: schemaIdent.getText(),
  };
}

function readStringLiteral(node: { getText: () => string } | undefined): string | undefined {
  if (!node) return undefined;
  const lit = (node as unknown as { asKind?: (k: SyntaxKind) => unknown }).asKind?.(
    SyntaxKind.StringLiteral,
  ) as { getLiteralValue?: () => string } | undefined;
  return lit?.getLiteralValue?.();
}

// ============================================================================
// Internal — resolve schema identifier to its import statement
// ============================================================================

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
  // TS module-specifiers haben keine .ts-Endung; das resolve hat sie
  // sowieso nicht angefügt, aber wenn jemand ".ts" im import schrieb →
  // weg damit.
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
