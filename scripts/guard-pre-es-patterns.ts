/**
 * Guard: findet Pre-ES-Patterns, die mit dem Event-Sourcing-Pivot entfernt
 * wurden und nicht zurückkehren dürfen.
 *
 * Geprüfte Patterns:
 *
 *   1. `createEventLog` / `EventLog` / `EventLogEntry`
 *      Der Redis-Stream-basierte Activity-Log wurde durch die `events`-Tabelle
 *      ersetzt (postgres). Ein neuer Import dieses Symbols ist immer ein
 *      Versehen — die Datei existiert nicht mehr.
 *
 *   2. `ctx.emit` / `r.postEvent`
 *      Vor Sprint E.2 waren das die APIs für pubsub-Events. Ersetzt durch
 *      `ctx.appendEvent` (Domain-Event auf Aggregate-Stream) + `r.multi-
 *      StreamProjection` (async Cross-Aggregate-Konsumenten). Die Symbole
 *      sind weg; ein Use zeigt auf unmigrated Code oder einen alten Copy-
 *      Paste aus einem verwaisten Sample.
 *
 *   3. `aggregateType: "configChanges"` als String-Literal
 *      Pre-ES-Stream vor dem config→configValue Refactor (2026-04-24).
 *      Konsumenten filtern jetzt auf `configValue.created/updated/deleted`.
 *      Ein verbleibendes String-Literal wäre ein toter Subscriber.
 *
 *   4. `CONFIG_CHANGED_EVENT_NAME` / `"config:event:config-changed"`
 *      Der pre-ES "config-changed"-Event wurde durch auto-Lifecycle-Events
 *      ersetzt.
 *
 * Exclude: Markdown-Dokus + dieser Guard selbst + Commit-Messages. Kommentare
 * in TS-Code werden mitgescannt bewusst — eine "ist hier als Referenz ok"-
 * Kommentar-Allowlist öffnet das Tor zu revivals. Wer wirklich in einem
 * Kommentar darüber schreiben muss, benutzt backticks (`EventLog`) um das
 * exakte Symbol zu vermeiden, oder eine abweichende Schreibweise.
 *
 * Usage:
 *   yarn tsx scripts/guard-pre-es-patterns.ts
 *
 * Exit 1 wenn Verstöße gefunden, 0 wenn sauber.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
  "samples/**/*.ts",
];

// Files die NICHT geprüft werden.
// - dist/ — Build-Output
// - dieser Guard selbst (enthält die Pattern-Namen im Code)
const EXCLUDE = /(^|\/)(dist|node_modules)\/|scripts\/guard-pre-es-patterns\.ts$/;

type Pattern = {
  readonly name: string;
  readonly description: string;
  readonly check: (sf: SourceFile) => Array<{ line: number; snippet: string }>;
};

// Identifier-Scan: prüft ob ein bestimmter Name als Identifier irgendwo im
// AST verwendet wird (nicht in Strings, nicht in Kommentaren).
function identifierHits(sf: SourceFile, name: string): Array<{ line: number; snippet: string }> {
  const out: Array<{ line: number; snippet: string }> = [];
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() !== name) continue;
    out.push({
      line: id.getStartLineNumber(),
      snippet: id.getParent()?.getText().slice(0, 120) ?? name,
    });
  }
  return out;
}

// String-Literal-Scan: prüft ob ein bestimmter String als Literal-Wert
// auftaucht (z.B. in Map-Lookups, SQL-Filtern, Event-Match-Blöcken).
function stringLiteralHits(
  sf: SourceFile,
  literal: string,
): Array<{ line: number; snippet: string }> {
  const out: Array<{ line: number; snippet: string }> = [];
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    if (lit.getLiteralText() !== literal) continue;
    out.push({
      line: lit.getStartLineNumber(),
      snippet: lit.getParent()?.getText().slice(0, 120) ?? literal,
    });
  }
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    if (lit.getLiteralText() !== literal) continue;
    out.push({
      line: lit.getStartLineNumber(),
      snippet: lit.getParent()?.getText().slice(0, 120) ?? literal,
    });
  }
  return out;
}

const PATTERNS: readonly Pattern[] = [
  {
    name: "createEventLog",
    description:
      "Pre-ES Redis-Stream-Activity-Log. Ersetzt durch die events-Tabelle + ctx.loadAggregate / queryProjection.",
    check: (sf) => identifierHits(sf, "createEventLog"),
  },
  {
    name: "EventLog / EventLogEntry (Type-Import)",
    description:
      "Type-Imports aus dem entfernten pipeline/event-log.ts. Ersetzt durch StoredEvent + getAllProjectionProgress.",
    check: (sf) => [...identifierHits(sf, "EventLog"), ...identifierHits(sf, "EventLogEntry")],
  },
  {
    name: "ctx.emit / emitEvent(ctx, …) pre-E.2",
    description:
      "Sprint-E.2 entfernte ctx.emit + PUBSUB_AGGREGATE_TYPE. Domain-Events gehen via ctx.appendEvent auf Aggregate-Streams.",
    check: (sf) => identifierHits(sf, "PUBSUB_AGGREGATE_TYPE"),
  },
  {
    name: "r.postEvent",
    description:
      "Sprint-E.2 entfernte r.postEvent als Registrar-API. Ersatz: r.multiStreamProjection für Cross-Aggregate-Konsumenten.",
    check: (sf) => {
      // Match `.postEvent(` property accesses to distinguish from the word
      // "postEvent" in prose. Identifier-scan would miss method invocations.
      const out: Array<{ line: number; snippet: string }> = [];
      for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        if (pa.getName() !== "postEvent") continue;
        // Only flag when invoked as a method — a property read named
        // postEvent on foreign types (theoretical) isn't the registrar API.
        const parent = pa.getParent();
        if (parent?.getKind() !== SyntaxKind.CallExpression) continue;
        out.push({
          line: pa.getStartLineNumber(),
          snippet: pa.getParent()?.getText().slice(0, 120) ?? ".postEvent",
        });
      }
      return out;
    },
  },
  {
    name: 'aggregateType: "configChanges"',
    description:
      'Pre-ES-Stream-Name. Konsumenten filtern auf aggregateType: "configValue" + Event-Types configValue.created/updated/deleted.',
    check: (sf) => stringLiteralHits(sf, "configChanges"),
  },
  {
    name: "config:event:config-changed Event-Name",
    description:
      "Pre-ES-Event. Ersetzt durch auto-Lifecycle-Events (configValue.created / .updated / .deleted).",
    check: (sf) => [
      ...stringLiteralHits(sf, "config:event:config-changed"),
      ...identifierHits(sf, "CONFIG_CHANGED_EVENT_NAME"),
    ],
  },
];

type Violation = {
  file: string;
  line: number;
  snippet: string;
  pattern: string;
};

async function main(): Promise<void> {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const violations: Violation[] = [];
  let scannedFiles = 0;

  for (const sf of project.getSourceFiles()) {
    const file = sf.getFilePath();
    if (EXCLUDE.test(file)) continue;
    scannedFiles++;

    for (const pat of PATTERNS) {
      for (const hit of pat.check(sf)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: hit.line,
          snippet: hit.snippet,
          pattern: pat.name,
        });
      }
    }
  }

  console.log(
    `Pre-ES-Patterns Guard: ${scannedFiles} Dateien geprüft, ${violations.length} Verstöße.`,
  );

  if (violations.length === 0) {
    console.log("  Keine pre-ES-Patterns.");
    // Sanity-Assertion: die Datei pipeline/event-log.ts darf nicht existieren.
    const eventLogPath = path.join(ROOT, "packages/framework/src/pipeline/event-log.ts");
    if (fs.existsSync(eventLogPath)) {
      console.error(
        "  BLOCKED: pipeline/event-log.ts wurde wiederhergestellt. Die Datei gehört gelöscht — ihre Rolle übernimmt die events-Tabelle.",
      );
      process.exit(1);
    }
    return;
  }

  console.error(`\n  BLOCKED: ${violations.length} pre-ES-Patterns in aktivem Code.\n`);
  const byPattern = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = byPattern.get(v.pattern) ?? [];
    list.push(v);
    byPattern.set(v.pattern, list);
  }
  for (const [name, list] of byPattern) {
    const pat = PATTERNS.find((p) => p.name === name);
    console.error(`  [${name}] ${pat?.description ?? ""}`);
    for (const v of list) {
      console.error(`    ${v.file}:${v.line}  ${v.snippet}`);
    }
    console.error("");
  }
  process.exit(1);
}

main();
