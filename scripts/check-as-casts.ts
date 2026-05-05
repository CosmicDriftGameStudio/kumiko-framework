/**
 * `as X` Cast Audit mit Baseline-Regression-Guard.
 *
 * Jeder `as X`-Cast ist ein Compiler-Knebel. Dieser Check zeigt alle Casts
 * im Production Code, kategorisiert in:
 *
 *   • legit-const      — `x as const`            (Literal-widening verhindern)
 *   • legit-brand      — `"..." as BrandedType`  (Branded-Type-Konstruktion)
 *   • legit-bridge     — `x as unknown as Y`     (bewusster Double-Cast)
 *   • legit-boundary   — Cast an System-Grenze, markiert mit `// @cast-boundary <reason>`
 *                        (Pipeline-payload, JSON-from-DB, Zod-Issue, Hook-Context)
 *   • suspect-parse    — cast direkt nach JSON.parse / .parseJsonSafe (externer Input)
 *   • suspect-narrow   — cast einer Variable zur Union-Verengung
 *   • suspect-general  — alles andere (TypeGuard- oder Typing-Kandidat)
 *
 * Die ersten vier sind legitim. Die letzten drei sind Refactor-Kandidaten.
 *
 * Boundary-Marker setzen wenn ein Cast inhärent an einer System-Grenze
 * sitzt (z.B. dispatch-payload ist generic über alle Entity-Types und
 * kann nicht weiter typisiert werden). Reason im Kommentar erklärt warum:
 *
 *   // @cast-boundary engine-payload — generic dispatch-Result über alle Entities
 *   const data = result.data as Record<string, unknown>;
 *
 * Baseline-Regression-Guard:
 *
 * `.kumiko-cast-baseline.json` im Repo-Root pinnt pro File die expected
 * suspect-Cast-Anzahl. Im Default-Lauf vergleicht der Audit gegen die
 * Baseline:
 *   - aktuell ≤ baseline pro File: PASS
 *   - aktuell > baseline pro File: FAIL (neue Casts hinzugekommen)
 * Reduktionen (aktuell < baseline) sind erlaubt aber updaten die Baseline
 * NICHT automatisch — nach Cleanup-Commits `--write-baseline` aufrufen.
 *
 * Usage:
 *   bun scripts/check-as-casts.ts                  # Vergleich gegen Baseline
 *   bun scripts/check-as-casts.ts --write-baseline # Baseline neu schreiben
 *   bun scripts/check-as-casts.ts --no-baseline    # Vergleich überspringen
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type AsExpression, Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
];

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

export type Category =
  | "legit-const"
  | "legit-brand"
  | "legit-bridge"
  | "legit-boundary"
  | "suspect-parse"
  | "suspect-narrow"
  | "suspect-general";

interface Site {
  file: string;
  line: number;
  category: Category;
  source: string; // source expression (left of `as`)
  target: string; // target type (right of `as`)
  full: string;
  /** boundary-reason wenn der Cast einen `@cast-boundary <reason>`-Marker
   *  hat. Nur relevant wenn category === "legit-boundary". */
  boundaryReason?: string;
}

function isStringLiteralLike(node: Node): boolean {
  const k = node.getKind();
  return (
    k === SyntaxKind.StringLiteral ||
    k === SyntaxKind.NoSubstitutionTemplateLiteral ||
    k === SyntaxKind.TemplateExpression ||
    k === SyntaxKind.NumericLiteral ||
    k === SyntaxKind.TrueKeyword ||
    k === SyntaxKind.FalseKeyword
  );
}

export function isConstAssertion(cast: AsExpression): boolean {
  const t = cast.getTypeNode();
  return !!t && t.getText() === "const";
}

// Matches `x as unknown as Y` — the inner cast is to `unknown`, the outer
// to something else. ts-morph exposes this as nested AsExpressions, with
// optional ParenthesizedExpression in between (depending on parenthesisation):
//   `x as unknown as Y`     → AsExpr(target=Y) → AsExpr(target=unknown) → x
//   `(x as unknown) as Y`   → AsExpr(target=Y) → ParenExpr → AsExpr(target=unknown) → x
// Wir gehen durch Parens transparent durch.
function unwrapParens(node: Node | undefined): Node | undefined {
  while (node?.getKind() === SyntaxKind.ParenthesizedExpression) {
    node = node.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression();
  }
  return node;
}

function climbParens(node: Node | undefined): Node | undefined {
  while (node?.getKind() === SyntaxKind.ParenthesizedExpression) {
    node = node.getParent();
  }
  return node;
}

export function isBridgeInner(cast: AsExpression): boolean {
  const t = cast.getTypeNode()?.getText();
  if (t !== "unknown") return false;
  const parent = climbParens(cast.getParent());
  return parent?.getKind() === SyntaxKind.AsExpression;
}

export function isBridgeOuter(cast: AsExpression): boolean {
  const expr = unwrapParens(cast.getExpression());
  if (expr?.getKind() !== SyntaxKind.AsExpression) return false;
  const inner = expr.asKindOrThrow(SyntaxKind.AsExpression);
  return inner.getTypeNode()?.getText() === "unknown";
}

// Is the cast target a Branded-style type? PascalCase identifier ending
// with "Id" / "Key" / "Token" / "Hash" etc.
const BRANDED_TARGET_RE = /^[A-Z]\w*(Id|Key|Token|Hash|Name|Ref|Code)$/;

// Heuristic: cast to a branded type from one of:
//   • String/numeric literal:        `"abc" as TenantId`
//   • PropertyAccess with name-match: `parsed.tenantId as TenantId`,
//                                     `row.userId as UserId`
//
// Property-access requires that the property name (camelCase) matches the
// target type name (PascalCase) — that's the convention for lifting a
// validated string/uuid into a branded type. Element-access notation
// (`payload["tenantId"] as TenantId`) is NOT covered: that pattern means
// the source is a generic Record/JSON without a typed shape, which is the
// anti-pattern we want to flag (zod-validate first, then brand off the
// validated property).
export function looksLikeBrandConstruction(cast: AsExpression): boolean {
  const target = cast.getTypeNode()?.getText() ?? "";
  if (!BRANDED_TARGET_RE.test(target)) return false;

  const expr = cast.getExpression();
  if (isStringLiteralLike(expr)) return true;

  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const propName = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    // Match property "tenantId" → target "TenantId" (camelCase ↔ PascalCase).
    return propName.length > 0 && propName[0]?.toUpperCase() + propName.slice(1) === target;
  }

  return false;
}

// Is the cast directly applied to a parse-Call result? Whitelist konkreter
// Parse-Functions plus Zod's typische `*Schema.parse()` / `*Schema.safeParse()`
// — `*.parse()` blanket-match wäre zu liberal (jeder eigene helper der
// `.parse` heißt würde matchen, z.B. `myArray.parse()`).
const PARSE_CALL_RE = /^(?:JSON\.parse|parseJsonSafe|parseJsonOrThrow|\w*[Ss]chema\.(?:parse|safeParse))$/;

export function isParseCast(cast: AsExpression): boolean {
  const expr = cast.getExpression();
  if (expr.getKind() !== SyntaxKind.CallExpression) return false;
  const call = expr.asKindOrThrow(SyntaxKind.CallExpression);
  const fn = call.getExpression().getText();
  return PARSE_CALL_RE.test(fn);
}

// Simple-identifier source → likely just "I have a variable, narrow its type".
// These are the prime candidates for Discriminated Unions or TypeGuards.
export function isNarrowingCast(cast: AsExpression): boolean {
  return cast.getExpression().getKind() === SyntaxKind.Identifier;
}

// Marker-Kommentar `// @cast-boundary <reason>` der den Cast als
// bewusste System-Grenze markiert. Statt String-Line-Matching nutzen
// wir den enclosing-Statement-Range mit Leading- und Trailing-Trivia
// — deckt leading-Block-Comments, trailing-Line-Comments, inline-
// Comments in multi-line Casts und mehrere Casts im selben Statement.
const BOUNDARY_MARKER_RE = /\/[/*]\s*@cast-boundary(?:\s+([\w-]+))?/;

// Whitelist anerkannter Reasons. Neue Reason erfordert Eintrag hier —
// verhindert Drift wie "engine-payload" / "engine_payload" /
// "engine payload" parallel im Repo. Audit zeigt Warning bei unbekannten
// Reasons; bei Bedarf erweitern + ggf. Konsumenten umbenennen.
export const KNOWN_BOUNDARY_REASONS = [
  // Pipeline / Engine
  "engine-payload", // dispatch-Result, event.payload, Hook-Context drilling
  "engine-bridge",  // public-API typed fn → erased internal storage (defineFeature builder)
  "error-details",  // DispatcherError.details / FieldIssue inspection
  "zod-issue",      // ZodIssue-internal shape (path, code, params)
  // Drizzle / DB
  "db-row",         // raw drizzle.execute<T>() row access
  "db-operator",    // drizzle eq/ne/lt/gt/inArray value-arg (Column-Type vs unknown)
  "db-runner",      // ctx.db.runInTx-callback OR TenantDb.raw → DbConnection (Connection|Tx beide drizzle-API-konform)
  "dynamic-key",    // PgTable[k] dynamic-key access (TS-Limitation)
  "user-row",       // user-table row → typed shape (e.g. roles JSON-string → string[])
  // Form / Generic
  "form-values",    // FormValues<T> dynamic-key indexing
  "generic-record", // generic Record<K,V>-Comparison helpers
  // Rendering
  "render-helper",  // Renderer internal field/value resolution
  // Walker / Inspector
  "recursive-walk", // leak-guard, recursive value scanner
  "schema-walk",    // feature-AST / schema-shape inspection
] as const;
export type BoundaryReason = (typeof KNOWN_BOUNDARY_REASONS)[number];

export function isKnownBoundaryReason(reason: string): reason is BoundaryReason {
  return (KNOWN_BOUNDARY_REASONS as readonly string[]).includes(reason);
}

export function hasBoundaryMarker(cast: AsExpression): boolean {
  return extractBoundaryReason(cast) !== null;
}

// Extracts the boundary reason or null if no marker. Returns the first
// whitespace-separated token after `@cast-boundary` (z.B. "engine-
// payload"). Empty string when marker has no reason.
//
// Scope der Marker-Suche (Reihenfolge: most-specific zuerst):
//   1. Leading-Comments die laut TS-Compiler dem Statement gehören
//      (`getLeadingCommentRanges` — kein Drift in vorhergehende Zeilen)
//   2. Cast-Range selbst (multi-line casts mit inline-comment)
//   3. Same-line trailing-comment am Cast-Ende (nicht weiter — würde
//      den nächsten Statement-Comment fälschlich claimen)
export function extractBoundaryReason(cast: AsExpression): string | null {
  const sf = cast.getSourceFile();
  const fullText = sf.getFullText();

  // (1) Leading comments des enclosing statement
  const stmt =
    cast.getFirstAncestorByKind(SyntaxKind.VariableStatement) ??
    cast.getFirstAncestorByKind(SyntaxKind.ExpressionStatement) ??
    cast.getFirstAncestorByKind(SyntaxKind.ReturnStatement) ??
    cast.getFirstAncestorByKind(SyntaxKind.PropertyAssignment);
  const leadingRanges = stmt?.getLeadingCommentRanges() ?? [];
  for (const r of leadingRanges) {
    const m = BOUNDARY_MARKER_RE.exec(r.getText());
    if (m) return m[1] ?? "";
  }

  // (2) Cast-Range selbst (multi-line casts, inline comments innerhalb)
  const castRange = fullText.slice(cast.getStart(), cast.getEnd());
  const inlineMatch = BOUNDARY_MARKER_RE.exec(castRange);
  if (inlineMatch) return inlineMatch[1] ?? "";

  // (3) Same-line trailing comment am Cast-Ende. Wir gehen vom Cast-End
  // zum nächsten EOL — das umfasst nur comments auf der Cast-Zeile, nicht
  // Folge-Statement-Comments.
  const castEnd = cast.getEnd();
  const eolPos = fullText.indexOf("\n", castEnd);
  const trailingRange = fullText.slice(castEnd, eolPos === -1 ? fullText.length : eolPos);
  const trailingMatch = BOUNDARY_MARKER_RE.exec(trailingRange);
  if (trailingMatch) return trailingMatch[1] ?? "";

  // (4) Same-line trailing comment am Statement-Ende (für Casts die nicht
  // selbst am Statement-Ende stehen — z.B. innerhalb einer Function-Call
  // Argument-Liste). Suche von Statement-End bis EOL.
  if (stmt) {
    const stmtEnd = stmt.getEnd();
    const stmtEol = fullText.indexOf("\n", stmtEnd);
    const stmtTrailingRange = fullText.slice(
      stmtEnd,
      stmtEol === -1 ? fullText.length : stmtEol,
    );
    const stmtTrailingMatch = BOUNDARY_MARKER_RE.exec(stmtTrailingRange);
    if (stmtTrailingMatch) return stmtTrailingMatch[1] ?? "";
  }

  return null;
}

// Type-Names die per Definition typing-loss-marker sind — siehe
// `packages/framework/src/db/connection.ts` (DbRow = Record<string, unknown>
// als bewusster Marker an der Drizzle-Boundary). Cast zu solchen Types
// IST der Marker — separater `@cast-boundary db-row`-Kommentar wäre
// redundant. Liste klein halten: nur Types die im Comment ausdrücklich
// als typing-loss-marker dokumentiert sind.
const TYPING_LOSS_MARKER_TYPES = new Set([
  "DbRow",
  "DbRow | undefined",
]);

export function isTypingLossMarkerCast(cast: AsExpression): boolean {
  return TYPING_LOSS_MARKER_TYPES.has(cast.getTypeNode()?.getText() ?? "");
}

// File-Default-Reasons: Verzeichnisse die per Konvention nur eine
// Sorte boundary-cast enthalten. Statt jeden Cast einzeln mit
// `@cast-boundary <reason>` zu markieren, gibt der Pfad-Match den
// Reason vor. Per-Cast-Marker übersteuert diesen Default trotzdem.
// Konvention beibehalten: nur Pfade die WIRKLICH einheitlich sind
// (nicht "fast einheitlich" — Drift-Gefahr).
const FILE_DEFAULT_REASONS: ReadonlyArray<{
  pattern: RegExp;
  reason: BoundaryReason;
}> = [
  {
    // feature-AST extractors: alle Casts gehen vom erased ts-morph-Parse-
    // Result zu typed feature-Definitionen (EntityDefinition, RelationDef,
    // NavDef, ConfigKeys, …). Per Konstruktion ein schema-walk.
    pattern: /\/engine\/feature-ast\//,
    reason: "schema-walk",
  },
];

export function getFileDefaultReason(filePath: string): BoundaryReason | null {
  for (const entry of FILE_DEFAULT_REASONS) {
    if (entry.pattern.test(filePath)) return entry.reason;
  }
  return null;
}

export function categorize(cast: AsExpression): Category {
  if (isConstAssertion(cast)) return "legit-const";
  if (isBridgeInner(cast) || isBridgeOuter(cast)) return "legit-bridge";
  if (looksLikeBrandConstruction(cast)) return "legit-brand";
  if (hasBoundaryMarker(cast)) return "legit-boundary";
  if (isTypingLossMarkerCast(cast)) return "legit-boundary";
  if (getFileDefaultReason(cast.getSourceFile().getFilePath()) !== null) return "legit-boundary";
  if (isParseCast(cast)) return "suspect-parse";
  if (isNarrowingCast(cast)) return "suspect-narrow";
  return "suspect-general";
}

function collect(sf: SourceFile): Site[] {
  const file = path.relative(ROOT, sf.getFilePath());
  const sites: Site[] = [];
  for (const cast of sf.getDescendantsOfKind(SyntaxKind.AsExpression)) {
    // Skip the outer half of a bridge — it's double-counted otherwise. We
    // report only the inner (the `as unknown`) so each bridge shows once.
    if (isBridgeOuter(cast)) continue;
    const category = categorize(cast);
    // TypingLossMarker-Casts (z.B. `as DbRow`) und FileDefault-Casts
    // (z.B. feature-ast/extractors.ts → "schema-walk") sind per Type-
    // Definition / Konvention boundary — synthetic reason damit der
    // unknown-reason-Check nicht fault wirft.
    const reason =
      category === "legit-boundary"
        ? (extractBoundaryReason(cast) ??
          (isTypingLossMarkerCast(cast) ? "db-row" : null) ??
          getFileDefaultReason(cast.getSourceFile().getFilePath()))
        : null;
    sites.push({
      file,
      line: cast.getStartLineNumber(),
      category,
      source: cast.getExpression().getText().slice(0, 60),
      target: cast.getTypeNode()?.getText().slice(0, 60) ?? "",
      full: cast.getText().slice(0, 100),
      ...(reason ? { boundaryReason: reason } : {}),
    });
  }
  return sites;
}

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const glob of SCAN_GLOBS) project.addSourceFilesAtPaths(path.join(ROOT, glob));

  const all: Site[] = [];
  let scanned = 0;
  for (const sf of project.getSourceFiles()) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    scanned++;
    all.push(...collect(sf));
  }

  const byCat = new Map<Category, Site[]>();
  for (const s of all) {
    const b = byCat.get(s.category) ?? [];
    b.push(s);
    byCat.set(s.category, b);
  }

  const cats: Category[] = [
    "legit-const",
    "legit-brand",
    "legit-bridge",
    "legit-boundary",
    "suspect-parse",
    "suspect-narrow",
    "suspect-general",
  ];

  console.log(`as-Cast Audit: ${scanned} Dateien gepruefft, ${all.length} Casts total.\n`);
  for (const c of cats) {
    const count = byCat.get(c)?.length ?? 0;
    console.log(`  ${c.padEnd(18)} ${count}`);
  }

  const suspects = cats.filter((c) => c.startsWith("suspect-"));

  // Aggregate suspect casts by target type — reveals bulk-refactor patterns
  // (e.g. "20x `as Record<string, unknown>`" → one DB-row helper fixes all).
  console.log("\n  Suspect-Cast Top-Targets (>=3):");
  const byTarget = new Map<string, Site[]>();
  for (const s of all) {
    if (!s.category.startsWith("suspect-")) continue;
    const bucket = byTarget.get(s.target) ?? [];
    bucket.push(s);
    byTarget.set(s.target, bucket);
  }
  const topTargets = [...byTarget.entries()]
    .filter(([, v]) => v.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [target, sites] of topTargets) {
    console.log(`    ${sites.length}x  as ${target}`);
  }

  for (const c of suspects) {
    const sites = byCat.get(c);
    if (!sites || sites.length === 0) continue;
    if (c === "suspect-general" && sites.length > 30) {
      console.log(`\n  ${c} (${sites.length}, showing top 30 by file):`);
      const sorted = [...sites].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      for (const s of sorted.slice(0, 30)) {
        const snippet = s.full.length > 90 ? `${s.full.slice(0, 87)}...` : s.full;
        console.log(`    ${s.file}:${s.line}  ${snippet}`);
      }
      console.log(`    ... (${sites.length - 30} more)`);
      continue;
    }
    console.log(`\n  ${c} (${sites.length}):`);
    for (const s of sites) {
      const snippet = s.full.length > 90 ? `${s.full.slice(0, 87)}...` : s.full;
      console.log(`    ${s.file}:${s.line}  ${snippet}`);
    }
  }

  console.log(
    "\n  Regel: jeder suspect-Cast ist Kandidat fuer TypeGuard, Discriminated Union, oder bessere Typisierung an der Quelle.",
  );

  // Reason-Validation: jeder legit-boundary-Cast muss einen bekannten
  // Reason haben. Unbekannte Reasons → Fail, weil Reason-Drift („engine-
  // payload" vs „enginePayload" vs „payload-engine") langfristig die
  // Audit-Aussagekraft zerstört. Whitelist-Erweiterung: in
  // KNOWN_BOUNDARY_REASONS oben eintragen.
  const unknownReasons: Array<{ file: string; line: number; reason: string }> = [];
  const reasonCounts = new Map<string, number>();
  for (const s of all) {
    if (s.category !== "legit-boundary") continue;
    const r = s.boundaryReason ?? "";
    reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    if (r === "" || !isKnownBoundaryReason(r)) {
      unknownReasons.push({ file: s.file, line: s.line, reason: r || "<missing>" });
    }
  }
  if (unknownReasons.length > 0) {
    console.log(`\n  UNKNOWN @cast-boundary REASONS (${unknownReasons.length}):`);
    for (const u of unknownReasons) {
      console.log(`    ${u.file}:${u.line}  reason=${u.reason}`);
    }
    console.log(
      "\n  Bekannte Reasons: " + KNOWN_BOUNDARY_REASONS.join(", "),
    );
    console.log(
      "  Neue Reason? Eintrag in scripts/check-as-casts.ts → KNOWN_BOUNDARY_REASONS.",
    );
    process.exit(1);
  }

  // Baseline-Regression-Guard.
  // Format: per File EIN Bucket pro target-Type (statt vorher nur file:count).
  // Damit fängt der Guard auch Cast-Tausch in derselben Datei: Cast A entfernt,
  // Cast B (anderes target) hinzugefügt — Total bleibt, aber per-target-Diff
  // zeigt die Verschiebung.
  const args = process.argv.slice(2);
  const writeBaseline = args.includes("--write-baseline");
  const noBaseline = args.includes("--no-baseline");
  const baselinePath = path.join(ROOT, ".kumiko-cast-baseline.json");

  // Per-File-per-target counts aufbauen
  const suspectByFileAndTarget: Record<string, Record<string, number>> = {};
  for (const s of all) {
    if (!s.category.startsWith("suspect-")) continue;
    const fileBuc = (suspectByFileAndTarget[s.file] ??= {});
    fileBuc[s.target] = (fileBuc[s.target] ?? 0) + 1;
  }
  const totalSuspect = Object.values(suspectByFileAndTarget)
    .flatMap((b) => Object.values(b))
    .reduce((a, b) => a + b, 0);

  // format-Version verhindert silent-green wenn ältere Baseline (ohne
  // per-target Sub-Records) noch lokal liegt — ohne Check würde
  // Object.keys(numberValue) leer zurückkommen und keine Regression
  // erkennen. Bei format-Drift muss Baseline explizit neu geschrieben
  // werden.
  const BASELINE_FORMAT_VERSION = 2;
  type Baseline = {
    format: number;
    generated: string;
    totalSuspect: number;
    perFile: Record<string, Record<string, number>>;
  };

  if (writeBaseline) {
    const payload: Baseline = {
      format: BASELINE_FORMAT_VERSION,
      generated: new Date().toISOString().slice(0, 10),
      totalSuspect,
      perFile: Object.fromEntries(
        Object.entries(suspectByFileAndTarget)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, targets]) => [
            file,
            Object.fromEntries(Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))),
          ]),
      ),
    };
    writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`\n  Baseline geschrieben: ${baselinePath}`);
    console.log(`  Total suspect: ${totalSuspect}`);
    return;
  }

  if (noBaseline) {
    console.log("\n  Baseline-Vergleich übersprungen (--no-baseline).");
    return;
  }

  if (!existsSync(baselinePath)) {
    console.log("\n  Keine Baseline gefunden. Erst mit `--write-baseline` einfrieren.");
    return;
  }

  const rawBaseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as Partial<Baseline>;
  if (rawBaseline.format !== BASELINE_FORMAT_VERSION) {
    console.log(
      `\n  Baseline-Format-Drift: erwartet format=${BASELINE_FORMAT_VERSION}, gelesen format=${rawBaseline.format ?? "<missing>"}.`,
    );
    console.log(
      "  Ohne format-Match würde der Guard silent-green laufen. Bitte einmalig:",
    );
    console.log("    bun scripts/check-as-casts.ts --write-baseline");
    process.exit(1);
  }
  const baseline = rawBaseline as Baseline;

  // Per File:target: aktueller Count gegen baseline. Mehr → Regression.
  // Cast-Tausch (Cast A weg, Cast B mit anderem target hinzu) wird so
  // erkannt obwohl Total stabil bleibt.
  type Regression = {
    file: string;
    target: string;
    baseline: number;
    current: number;
  };
  const regressions: Regression[] = [];
  let reduced = 0;
  const allFiles = new Set([
    ...Object.keys(suspectByFileAndTarget),
    ...Object.keys(baseline.perFile),
  ]);
  for (const file of allFiles) {
    const baselineTargets = baseline.perFile[file] ?? {};
    const currentTargets = suspectByFileAndTarget[file] ?? {};
    const allTargets = new Set([
      ...Object.keys(baselineTargets),
      ...Object.keys(currentTargets),
    ]);
    for (const target of allTargets) {
      const expected = baselineTargets[target] ?? 0;
      const current = currentTargets[target] ?? 0;
      if (current > expected) {
        regressions.push({ file, target, baseline: expected, current });
      } else if (current < expected) {
        reduced += expected - current;
      }
    }
  }

  if (regressions.length > 0) {
    console.log(
      `\n  REGRESSION: ${regressions.length} (file, target)-Pair(s) haben mehr suspect-Casts als Baseline:`,
    );
    for (const r of regressions) {
      console.log(
        `    ${r.file}: as ${r.target}  baseline=${r.baseline} current=${r.current} (+${r.current - r.baseline})`,
      );
    }
    console.log(
      "\n  Neue Casts brauchen Begründung. Optionen:\n" +
        "    1. Cast vermeiden (TypeGuard, Discriminated Union, bessere Source-Typisierung)\n" +
        "    2. Wenn legit System-Boundary: `// @cast-boundary <reason>` Marker setzen\n" +
        "    3. Wenn Cleanup-Reduktion in einem File aber Zuwachs in einem anderen: " +
        "`bun scripts/check-as-casts.ts --write-baseline` nach Commit",
    );
    process.exit(1);
  }

  console.log(`\n  ✓ Baseline (${baseline.totalSuspect}) — aktuell ${totalSuspect}`);
  if (reduced > 0) {
    console.log(
      `  ✓ ${reduced} suspect-Cast(s) reduziert seit Baseline. Ggf. \`--write-baseline\` aufrufen.`,
    );
  }
}

main();
