#!/usr/bin/env bun
/**
 * Guard: finds pre-ES patterns that were removed with the event-sourcing
 * pivot and must not return.
 *
 * Checked patterns:
 *
 *   1. `createEventLog` / `EventLog` / `EventLogEntry`
 *      The Redis-stream-based activity log was replaced by the `events`
 *      table (postgres). A new import of this symbol is always a mistake —
 *      the file no longer exists.
 *
 *   2. `ctx.emit` / `r.postEvent`
 *      Before sprint E.2 these were the pubsub-event APIs. Replaced by
 *      `ctx.appendEvent` (domain event on an aggregate stream) +
 *      `r.multiStreamProjection` (async cross-aggregate consumers). The
 *      symbols are gone; a use points at unmigrated code or an old
 *      copy-paste from an orphaned sample.
 *
 *   3. `aggregateType: "configChanges"` as a string literal
 *      Pre-ES stream from before the config→configValue refactor
 *      (2026-04-24). Consumers now filter on
 *      `configValue.created/updated/deleted`. A remaining string literal
 *      would be a dead subscriber.
 *
 *   4. `CONFIG_CHANGED_EVENT_NAME` / `"config:event:config-changed"`
 *      The pre-ES "config-changed" event was replaced by auto lifecycle
 *      events.
 *
 * Exclude: markdown docs + this guard itself + commit messages. Comments in
 * TS code are deliberately scanned too — a "this is ok as a reference"
 * comment allowlist would open the door to revivals. Anyone who genuinely
 * needs to write about this in a comment uses backticks (`EventLog`) to
 * avoid the exact symbol, or a different spelling.
 *
 * Usage:
 *   bun guards/guard-pre-es-patterns.ts        (standalone)
 *   via _lib/guard-kit shared runner            (kumiko check)
 *
 * Exit 1 on violations, 0 when clean.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

// Files that are NOT checked.
// - dist/ — build output
// - this guard itself (contains the pattern names in code)
const EXCLUDE = /(^|\/)(dist|node_modules)\/|guard-pre-es-patterns\.ts$/;

type Pattern = {
  readonly name: string;
  readonly description: string;
  readonly check: (sf: SourceFile) => Array<{ line: number; snippet: string }>;
};

// Identifier scan: checks whether a given name is used anywhere as an
// identifier in the AST (not in strings, not in comments).
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

// String-literal scan: checks whether a given string appears as a literal
// value (e.g. in map lookups, SQL filters, event-match blocks).
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
      // "postEvent" in prose. Identifier scan would miss method invocations.
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

export const guard: AstGuard = {
  name: "Pre-ES-Patterns Guard",
  scan: SCAN,
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;

      for (const pat of PATTERNS) {
        for (const hit of pat.check(sf)) {
          violations.push({
            file: path.relative(ROOT, file),
            line: hit.line,
            message: `[${pat.name}] ${hit.snippet}`,
          });
        }
      }
    }

    // Sanity assertion: pipeline/event-log.ts must not exist.
    const eventLogPath = path.join(ROOT, "packages/framework/src/pipeline/event-log.ts");
    if (fs.existsSync(eventLogPath)) {
      violations.push({
        file: "packages/framework/src/pipeline/event-log.ts",
        line: 0,
        message:
          "BLOCKED: pipeline/event-log.ts was restored. The file must be deleted — the events table now takes over its role.",
      });
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
