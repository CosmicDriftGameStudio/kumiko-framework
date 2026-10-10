#!/usr/bin/env bun
/**
 * Guard R8: forbids `broker.subscribe(...)` outside the framework.
 *
 * Feature and app code must NEVER subscribe to the event broker directly — the
 * registrar API is the only allowed way to consume events:
 *   - `r.onEvent("event-name", handler)`
 *   - `r.job({ trigger: { on: "event-name" }, handler })`
 *
 * A direct `broker.subscribe(...)` bypasses lifecycle, idempotency, dedup
 * and replay of the dispatcher — exactly the guarantees the registrar API
 * gives. Today there is NO such call in the Kumiko code (the broker is
 * framework-internal, not exported) — the guard is a tripwire that fires as
 * soon as someone introduces a broker abstraction and hooks feature code
 * directly onto it.
 *
 * Detection (name heuristic, no type resolution): `X.subscribe(...)` where the
 * terminal identifier of `X` is `broker` or `eventBroker` (case-
 * insensitive — catches `broker`, `eventBroker`, `ctx.broker`, `this.eventBroker`).
 * Store/observable `.subscribe` (RxJS, React `controller.subscribe`) is not
 * named `broker` → no hit.
 *
 * Exception: `packages/framework/src/pipeline/**` — the broker plumbing
 * itself lives there (framework-internal, allowed).
 *
 * Usage: bun guards/guard-broker-subscribe.ts
 * Exit 1 on a finding, 0 when clean.
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
