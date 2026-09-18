#!/usr/bin/env bun
/**
 * Guard R8: verbietet `broker.subscribe(...)` ausserhalb des Frameworks.
 *
 * Feature- und App-Code soll NIE direkt an den Event-Broker subscriben — die
 * Registrar-API ist der einzige erlaubte Weg, Events zu konsumieren:
 *   - `r.onEvent("event-name", handler)`
 *   - `r.job({ trigger: { on: "event-name" }, handler })`
 *
 * Ein direktes `broker.subscribe(...)` umgeht Lifecycle, Idempotency, Dedup
 * und Replay des Dispatchers — genau die Garantien, die die Registrar-API
 * gibt. Heute gibt es im Kumiko-Code KEINEN solchen Call (der Broker ist
 * framework-intern, nicht exportiert) — der Guard ist ein Tripwire, der
 * zuschlägt, sobald jemand eine Broker-Abstraktion einführt und Feature-Code
 * direkt daran hängt.
 *
 * Erkennung (Name-Heuristik, keine Typ-Resolution): `X.subscribe(...)` wo der
 * terminale Bezeichner von `X` `broker` oder `eventBroker` heisst (case-
 * insensitive — fängt `broker`, `eventBroker`, `ctx.broker`, `this.eventBroker`).
 * Store-/Observable-`.subscribe` (RxJS, React `controller.subscribe`) heisst
 * nicht `broker` → kein Treffer.
 *
 * Ausnahme: `packages/framework/src/pipeline/**` — dort lebt das Broker-
 * Plumbing selbst (framework-intern, erlaubt).
 *
 * Usage: bun guards/guard-broker-subscribe.ts
 * Exit 1 bei Fund, 0 wenn sauber.
 */

import * as path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|\.g\.ts$)/;

// Broker-Plumbing selbst — framework-intern, darf subscriben.
const ALLOW = /(^|\/)packages\/framework\/src\/pipeline\//;

const BROKER_RECEIVER = /^(event)?broker$/i;

export function isAllowed(filePath: string): boolean {
  return ALLOW.test(path.relative(ROOT, filePath));
}

/** Terminaler Bezeichner einer Receiver-Expression: `ctx.eventBroker` → "eventBroker". */
function receiverName(node: import("ts-morph").Node): string | undefined {
  if (node.getKind() === SyntaxKind.Identifier) return node.getText();
  const pae = node.asKind(SyntaxKind.PropertyAccessExpression);
  return pae?.getName();
}

export function collectBrokerSubscribeViolations(
  sf: SourceFile,
): Array<{ line: number; message: string }> {
  const hits: Array<{ line: number; message: string }> = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const pae = callee.asKind(SyntaxKind.PropertyAccessExpression);
    if (pae?.getName() !== "subscribe") continue;
    const recv = receiverName(pae.getExpression());
    if (!recv || !BROKER_RECEIVER.test(recv)) continue;
    hits.push({
      line: call.getStartLineNumber(),
      message: `[${recv}.subscribe] ${recv}.subscribe(...) — use r.onEvent(...) or r.job({ trigger: { on } })`,
    });
  }
  return hits;
}

export const guard: AstGuard = {
  name: "No-Broker-Subscribe Guard",
  scan: SCAN,
  hint: "Consume events through the registrar API (r.onEvent / r.job trigger.on), not directly on the broker — see docs/plans/architecture/lint-rules.md (R8).",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file) || isAllowed(file)) continue;
      for (const hit of collectBrokerSubscribeViolations(sf)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: hit.line,
          message: hit.message,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
