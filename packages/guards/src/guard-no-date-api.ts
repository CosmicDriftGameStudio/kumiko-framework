#!/usr/bin/env bun
/**
 * Guard: finds Date-API patterns in production code where they are banned.
 *
 * Checked patterns (all Date-specific, Temporal has its own equivalents):
 *   - `new Date(...)`            → Temporal.Now.instant() / Temporal.Instant.from
 *   - `.toISOString()`           → Temporal.Instant.toString() (canonical ISO)
 *   - `.getTime()`               → Temporal.Instant.epochMilliseconds
 *
 * `Date.now()` and `Date.parse()` are NOT checked — Date.now() is the
 * idiomatic way to measure a duration (`Date.now() - startedAt`), and
 * Temporal.Now.instant().epochMilliseconds is 4x longer for no benefit.
 *
 * Background: kumiko has a Temporal-based time API via `ctx.tz`. Feature
 * code should use wall-clock + IANA-TZ via ctx.tz.parse / ctx.tz.now /
 * ctx.tz.fromLocatedJson, NOT `new Date(...)` directly — that's the JS-Date
 * trap (implicit local-TZ conversion in the browser, Hermes lacked
 * Temporal for a long time, etc.). Sprint F carried this through
 * atomically.
 *
 * Allowlist: paths that legitimately need the Date API (HTTP header specs,
 * polyfill detection, Date↔Temporal bridges, JSON wire-format backwards
 * compat). Test files are generally allowed.
 *
 * Usage:
 *   bun guards/guard-no-date-api.ts
 *
 * Exit 1 on violations in non-allowlisted files, 0 when clean.
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

// Files that are NOT checked — tests, type defs, generated code.
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|\.g\.ts$)/;

// Framework internals are still allowed to `new Date()`: they implement the
// TZ layer themselves or hang off the DB driver where Date is the native
// wire format. Migration plan: paths get removed from this allowlist per
// feature/sample as they migrate to ctx.tz. Goal: the allowlist shrinks.
const ALLOWLIST = [
  // Framework time layer itself
  /packages\/framework\/src\/time\//,
  // DB layer: drizzle column wrapper, migration tooling — Date is a
  // primitive wire format there
  /packages\/framework\/src\/db\//,
  // Bun.SQL layer (post-Drizzle replacement) — same boundary as db/,
  // converts Date→Temporal at the driver boundary.
  /packages\/framework\/src\/bun-db\//,
  // Event-store internals: createdAt stamps, snapshot time, archive time
  /packages\/framework\/src\/event-store\//,
  // Pipeline: system hooks, idempotency cache (low-level timestamps)
  /packages\/framework\/src\/pipeline\//,
  // Errors: timestamp in the error body
  /packages\/framework\/src\/errors\//,
  // Jobs: job-run timestamps (the job runner is a time source for cron)
  /packages\/framework\/src\/jobs\//,
  // API layer: request timestamps in logs
  /packages\/framework\/src\/api\//,
  // Logging
  /packages\/framework\/src\/logging\//,
  // i18n
  /packages\/framework\/src\/i18n\//,
  // Observability
  /packages\/framework\/src\/observability\//,
  // Engine internals (factories, registry, config) — when they need Date
  // it's defaults/audit stamps working together with the DB layer.
  /packages\/framework\/src\/engine\/(types|registry|config-helpers|create-app|define-feature|state-machine|access|field-access|boot-validator|qualified-name)\.ts$/,
  // Testing helpers
  /packages\/framework\/src\/testing\//,
  // Search adapter internals
  /packages\/framework\/src\/search\//,
  // File storage (coming in Gap-04)
  /packages\/framework\/src\/files\//,

  // Sprint F's atomic switch migrated bundled-features + samples to
  // Temporal.Now.instant() — no blanket allowlist anymore. Beammycar's
  // migration reads legacy-DB Date columns (V2 schema, no Temporal): the
  // `pg` driver rows arrive as JS `Date`, the `dateToInstant` helper
  // bridges them to `Temporal.Instant` via `.getTime()`. A pure bridge
  // layer.
  /samples\/showcases\/beammycar\/src\/migration\//,

  // === Legitimate Date-API spots ===
  // Polyfill detection: typeof globalThis.Temporal vs new Date(0) — no
  // Temporal available because we're checking if it's there right now.
  /packages\/framework\/src\/time\/polyfill\.ts$/,
  // HTTP Date headers (RFC 7231): Last-Modified / Expires / signed-URL
  // expiresAt are Date-typed in the HTTP spec, not a Temporal format.
  /packages\/framework\/src\/files\/file-routes\.ts$/,
  // Error serialization: timestamp in the JSON wire body for backwards
  // compat with every client that has expected an ISO string since Sprint A.
  /packages\/framework\/src\/errors\/serialize\.ts$/,
  // Entity cache: parsing arbitrary input (could be Date or ISO string),
  // Number.isNaN(d.getTime()) as a validity check.
  /packages\/framework\/src\/pipeline\/entity-cache\.ts$/,
  // Event-store insertSubsequentEvent: raw SQL row.created_at can be Date|string
  // (postgres-js driver-config dependent), normalised to Temporal.Instant via
  // .getTime() bridge.
  /packages\/framework\/src\/event-store\/event-store\.ts$/,
  // HTTP Last-Modified/ETag header: Bun/Node Response API expects a native
  // Date object from fs.Stats.mtimeMs — wire boundary, not a Temporal format.
  /packages\/server-runtime\/src\/run-prod-app-static-files\.ts$/,
  // Bun.SQL timestamptz columns arrive as native Date (driver wire format,
  // same reason as packages/framework/src/bun-db/ above).
  /packages\/publish\/src\/rollback\.ts$/,
];

interface Violation {
  file: string;
  line: number;
  snippet: string;
  pattern: "new Date" | ".toISOString" | ".getTime";
}

function isAllowlisted(filePath: string): boolean {
  const rel = path.relative(ROOT, filePath);
  return ALLOWLIST.some((re) => re.test(rel));
}

function findDateApiUsages(sf: SourceFile): Omit<Violation, "file">[] {
  const result: Omit<Violation, "file">[] = [];

  // Pattern 1: `new Date(...)`
  for (const expr of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (expr.getExpression().getText() === "Date") {
      result.push({
        line: expr.getStartLineNumber(),
        snippet: expr.getText(),
        pattern: "new Date",
      });
    }
  }

  // Pattern 2: `.toISOString()` and `.getTime()` — property access in a call.
  // Temporal.Instant has neither method, so any hit is a Date-API call.
  for (const expr of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = expr.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const name = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    if (name === "toISOString" || name === "getTime") {
      result.push({
        line: expr.getStartLineNumber(),
        snippet: expr.getText(),
        pattern: name === "toISOString" ? ".toISOString" : ".getTime",
      });
    }
  }

  return result;
}

export const guard: AstGuard = {
  name: "No-Date-API Guard",
  scan: SCAN,
  hint: "Replace with Temporal.Now.instant() / Temporal.Instant.from / .toString() / .epochMilliseconds — see docs/plans/architecture/timezones.md.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;
      if (isAllowlisted(file)) continue;
      for (const usage of findDateApiUsages(sf)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: usage.line,
          message: `[${usage.pattern}] ${usage.snippet}`,
        });
      }
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
