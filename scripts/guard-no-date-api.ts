/**
 * Guard: findet Date-API-Patterns in Production-Code wo sie verboten sind.
 *
 * Geprüfte Patterns (alle Date-spezifisch, Temporal hat eigene Equivalente):
 *   - `new Date(...)`            → Temporal.Now.instant() / Temporal.Instant.from
 *   - `.toISOString()`           → Temporal.Instant.toString() (canonical ISO)
 *   - `.getTime()`               → Temporal.Instant.epochMilliseconds
 *
 * `Date.now()` und `Date.parse()` werden NICHT geprüft — Date.now() ist der
 * idiomatische Weg für duration-measurement (`Date.now() - startedAt`), und
 * Temporal.Now.instant().epochMilliseconds ist 4x länger ohne Mehrwert.
 *
 * Hintergrund: kumiko hat eine Temporal-basierte Time-API über `ctx.tz`.
 * Feature-Code soll Wall-Clock + IANA-TZ über ctx.tz.parse / ctx.tz.now /
 * ctx.tz.fromLocatedJson nutzen, NICHT `new Date(...)` direkt — das ist
 * die JS-Date-Falle (lokale TZ-Implizit-Konvertierung im Browser, Hermes
 * fehlt Temporal lange, etc.). Sprint F hat das atomic durchgezogen.
 *
 * Allowlist: Pfade die legitim Date-API brauchen (HTTP-Header-Specs,
 * Polyfill-Detection, Date↔Temporal-Bridges, JSON-Wire-Format-Backwards-
 * Compat). Test-Files sind generell erlaubt.
 *
 * Usage:
 *   yarn tsx scripts/guard-no-date-api.ts
 *
 * Exit 1 wenn Verstöße in nicht-allowlisted Files, 0 wenn sauber.
 */

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

// Files die NICHT geprüft werden — Tests, Type-Defs, generierter Code.
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|\.g\.ts$)/;

// Framework-Internals dürfen `new Date()` weiterhin: sie implementieren
// die TZ-Layer selbst oder hängen am DB-Driver wo Date das Native ist.
// Migrations-Plan: pro Feature/Sample werden Pfade aus dieser Allowlist
// entfernt sobald sie auf ctx.tz migriert sind. Ziel: Allowlist schrumpft.
const ALLOWLIST = [
  // Framework-Time-Layer selbst
  /packages\/framework\/src\/time\//,
  // DB-Layer: drizzle-Spalten-Wrapper, Migration-Tooling — Date ist dort
  // primitives Wire-Format
  /packages\/framework\/src\/db\//,
  // Event-Store Internals: createdAt-Stamps, Snapshot-Time, Archive-Time
  /packages\/framework\/src\/event-store\//,
  // Pipeline: System-Hooks, Idempotency-Cache (low-level Timestamps)
  /packages\/framework\/src\/pipeline\//,
  // Errors: Timestamp im Error-Body
  /packages\/framework\/src\/errors\//,
  // Jobs: Job-Run-Timestamps (Job-Runner ist ein Time-Quelle für Cron)
  /packages\/framework\/src\/jobs\//,
  // API-Layer: Request-Timestamps in Logs
  /packages\/framework\/src\/api\//,
  // Logging
  /packages\/framework\/src\/logging\//,
  // i18n
  /packages\/framework\/src\/i18n\//,
  // Observability
  /packages\/framework\/src\/observability\//,
  // Engine internals (factories, registry, config) — wenn die Date brauchen
  // sind das defaults/audit-stamps die mit der DB-Schicht zusammenarbeiten.
  /packages\/framework\/src\/engine\/(types|registry|config-helpers|create-app|define-feature|state-machine|access|field-access|boot-validator|qualified-name)\.ts$/,
  // Testing-Helpers
  /packages\/framework\/src\/testing\//,
  // Search adapter internals
  /packages\/framework\/src\/search\//,
  // File-Storage (kommt in Gap-04)
  /packages\/framework\/src\/files\//,

  // Sprint F atomic-Switch hat bundled-features + samples auf Temporal.Now.instant()
  // migriert — keine pauschale Allowlist mehr. Beammycar/migration liest
  // LegacyDB-Date-Spalten (V2-Schema, kein Temporal): die `pg`-Driver-Rows
  // kommen als JS-`Date`, der `dateToInstant`-Helper bridged sie über
  // `.getTime()` zu `Temporal.Instant`. Reine Bridge-Schicht.
  /samples\/showcases\/beammycar\/src\/migration\//,

  // === Date-API legitime Stellen ===
  // Polyfill-Detection: typeof globalThis.Temporal vs new Date(0) — kein
  // Temporal verfügbar weil wir GERADE checken ob's da ist.
  /packages\/framework\/src\/time\/polyfill\.ts$/,
  // HTTP Date-Headers (RFC 7231): Last-Modified / Expires / signed-URL
  // expiresAt sind Date-typed im HTTP-Spec, kein Temporal-Format.
  /packages\/framework\/src\/files\/file-routes\.ts$/,
  // Error-Serialization: timestamp im JSON-Wire-Body für Backwards-Compat
  // mit allen Clients die seit Sprint A einen ISO-String erwarten.
  /packages\/framework\/src\/errors\/serialize\.ts$/,
  // Entity-Cache: parsing arbitrary input (could be Date or ISO-string),
  // Number.isNaN(d.getTime()) als Validity-Check.
  /packages\/framework\/src\/pipeline\/entity-cache\.ts$/,
  // Event-Store insertSubsequentEvent: raw SQL row.created_at can be Date|string
  // (postgres-js driver-config dependent), normalised to Temporal.Instant via
  // .getTime() bridge.
  /packages\/framework\/src\/event-store\/event-store\.ts$/,
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

  // Pattern 2: `.toISOString()` and `.getTime()` — property-access in call.
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
    if (isAllowlisted(file)) continue;
    scannedFiles++;

    for (const usage of findDateApiUsages(sf)) {
      violations.push({
        file: path.relative(ROOT, file),
        line: usage.line,
        snippet: usage.snippet,
        pattern: usage.pattern,
      });
    }
  }

  console.log(
    `No-Date-API Guard: ${scannedFiles} non-allowlisted Dateien, ${violations.length} Verstöße.`,
  );

  if (violations.length === 0) {
    console.log("  Keine Date-API-Patterns in Feature-Code.");
    return;
  }

  console.error(
    `\n  BLOCKED: ${violations.length} Date-API-Verstöße in Feature-Code. ` +
      `Ersetze mit Temporal.Now.instant() / Temporal.Instant.from / Temporal.Instant.toString() / ` +
      `Temporal.Instant.epochMilliseconds — siehe docs/plans/architecture/timezones.md.\n`,
  );
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  [${v.pattern}]  ${v.snippet}`);
  }
  console.error("");
  process.exit(1);
}

main();
