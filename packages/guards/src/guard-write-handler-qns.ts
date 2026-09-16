#!/usr/bin/env bun
/**
 * Guard: prüft dass `dispatcher.write("qn:literal:...")`-Aufrufe in
 * Custom-Screens gültige Write-Handler-QNs referenzieren. Tippfehler
 * im QN fallen sonst erst zur Runtime als 404 auf.
 *
 * Validierung in zwei Stufen:
 *   1. **Strukturell**: jeder QN muss `:write:` enthalten — fängt
 *      offensichtliche Tippfehler ("feautre:write:create").
 *   2. **Gegen Manifest**: wenn `feature-manifest.json` im Repo-Root
 *      liegt und `writeHandlers` enthält, matched der Guard dagegen.
 *
 * Usage:
 *   bun infra/guards/guard-write-handler-qns.ts
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { toKebab, VALID_QN_RE } from "./_lib/qn";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

export { toKebab, VALID_QN_RE };

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["tsx"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

// Tests nutzen absichtlich generische QNs wie dispatcher.write("x", {}).
const EXCLUDE = /(__tests__|\.test\.tsx$|\.integration\.tsx$|\/node_modules\/|\/dist\/)/;

/**
 * Reads writeHandlers per manifest found under each repo root, keyed by
 * the manifest's own directory. Stage-2 matching is subtree-scoped to that
 * directory — prevents cross-app false positives when a repo hosts several
 * independent sample apps, each with its own (or no) manifest.
 */
interface ManifestEntry {
  readonly baseDir: string;
  readonly known: Set<string>;
}

function loadKnownQnsByRepo(roots: ReadonlyArray<RepoRoot>): Map<string, ManifestEntry[]> {
  const byRepo = new Map<string, ManifestEntry[]>();

  const manifestCandidates = [
    "feature-manifest.json",
    "samples/apps/use-all-bundled/feature-manifest.json",
  ];

  for (const repo of roots) {
    const entries: ManifestEntry[] = [];
    for (const rel of manifestCandidates) {
      const manifestPath = path.join(repo.absPath, rel);
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as {
          readonly features?: ReadonlyArray<{
            readonly writeHandlers?: readonly string[];
          }>;
        };
        if (!manifest.features) continue;
        const known = new Set<string>();
        for (const f of manifest.features) {
          if (f.writeHandlers) {
            for (const qn of f.writeHandlers) known.add(qn);
          }
        }
        if (known.size > 0) {
          entries.push({ baseDir: path.dirname(manifestPath), known });
        }
      } catch (err) {
        console.warn(`[WARN] Manifest ${manifestPath} not readable: ${err}`);
      }
    }
    if (entries.length > 0) byRepo.set(repo.absPath, entries);
  }
  return byRepo;
}

/** Picks the manifest whose base directory is the longest prefix of `filePath`. */
function findKnownQns(filePath: string, entries: ReadonlyArray<ManifestEntry>): Set<string> {
  let best: ManifestEntry | undefined;
  for (const entry of entries) {
    if (filePath !== entry.baseDir && !filePath.startsWith(`${entry.baseDir}${path.sep}`)) continue;
    if (!best || entry.baseDir.length > best.baseDir.length) best = entry;
  }
  return best?.known ?? new Set<string>();
}

/**
 * Extrahiert den Literal-Wert aus einem String-Literal, einem
 * Backtick-Literal ohne Interpolation (`NoSubstitutionTemplateLiteral`) oder
 * einem `<literal> as T`-Cast. Backtick-Konstanten (`const QN = \`x:write:y\``)
 * wurden vorher nur als direktes Argument, nicht als aufgelöste Deklaration
 * erkannt.
 */
function literalValueOf(node: Node): string | undefined {
  if (
    node.isKind(SyntaxKind.StringLiteral) ||
    node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
  ) {
    return node.getLiteralValue();
  }
  if (node.isKind(SyntaxKind.AsExpression)) {
    return literalValueOf(node.getExpression());
  }
  return undefined;
}

/** Resolve Handler-constant refs (`Handlers.foo`) to string literals when static. */
export function resolveWriteQnFromArg(node: Node): string | undefined {
  const direct = literalValueOf(node);
  if (direct !== undefined) return direct;

  if (!node.isKind(SyntaxKind.Identifier) && !node.isKind(SyntaxKind.PropertyAccessExpression)) {
    return undefined;
  }

  const symbol = node.getSymbol() ?? node.getType().getSymbol();
  if (!symbol) return undefined;

  for (const decl of symbol.getDeclarations()) {
    if (decl.isKind(SyntaxKind.PropertyAssignment) || decl.isKind(SyntaxKind.VariableDeclaration)) {
      const init = decl.getInitializer();
      const value = init ? literalValueOf(init) : undefined;
      if (value !== undefined) return value;
    }
  }

  return undefined;
}

/**
 * Scannt eine SourceFile nach `dispatcher.write(<stringLiteral>, ...)`-
 * oder `<expr>.write(<stringLiteral>, ...)`-Aufrufen.
 */
export function scanDispatcherWriteCalls(
  sf: SourceFile,
): Array<{ line: number; qn: string; snippet: string }> {
  const hits: Array<{ line: number; qn: string; snippet: string }> = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const exprText = expr.getText();

    // `dispatcher.write(...)` oder irgendein `<obj>.write(...)` (ein
    // aliaster Dispatcher heißt nicht zwingend "dispatcher").
    const isDispatcherCall = exprText === "dispatcher.write";
    if (!isDispatcherCall && !exprText.endsWith(".write")) continue;

    // Erster Parameter muss ein String-Literal sein — dynamische
    // QNs (Handler-Konstanten, Template-Literale) werden nicht
    // validiert (sind entweder typ-safe oder nicht prüfbar).
    const args = call.getArguments();
    const first = args[0];
    if (!first) continue;

    const qn = resolveWriteQnFromArg(first);
    if (qn === undefined) continue;

    // `.endsWith(".write")` matcht auch Nicht-Dispatcher-Writes:
    // `res.write(...)`, `stream.write(...)`, SSE `res.write("data: …")`.
    // Deren Argument ist kein QN → würde sonst als "ungültiges QN-Format"
    // false-positiv gemeldet. Außerhalb eines expliziten `dispatcher.write`
    // nur prüfen, wenn das Literal ein Write-QN ist (enthält ":write:").
    if (!isDispatcherCall && !qn.includes(":write:")) continue;

    hits.push({
      line: call.getStartLineNumber(),
      qn,
      snippet: call.getText().slice(0, 120),
    });
  }
  return hits;
}

export const guard: AstGuard = {
  name: "Write-Handler-QN Guard",
  scan: SCAN,
  hint: "Typo in the write-handler QN? Check feature name + handler name.",
  run(files) {
    const roots = resolveRepoRoots();
    const knownQnsByRepo = loadKnownQnsByRepo(roots);

    const violations: Array<{
      file: string;
      line: number;
      message: string;
    }> = [];

    for (const sf of files) {
      const filePath = sf.getFilePath();
      if (EXCLUDE.test(filePath)) continue;

      const repo = roots.find((r) => filePath.startsWith(`${r.absPath}${path.sep}`));
      const knownQns = repo
        ? findKnownQns(filePath, knownQnsByRepo.get(repo.absPath) ?? [])
        : new Set<string>();

      for (const hit of scanDispatcherWriteCalls(sf)) {
        // Stufe 1: strukturelle Validierung
        if (!VALID_QN_RE.test(hit.qn)) {
          violations.push({
            file: path.relative(ROOT, filePath),
            line: hit.line,
            message: `invalid QN format: "${hit.qn}" — must match "<feature>:write:<handler>"`,
          });
          continue;
        }

        // Stufe 2: gegen Manifest matchen (wenn vorhanden).
        // QN wird vor dem Match auf kebab-case normalisiert, sodass
        // camelCase- und kebab-case-Eingaben gleich behandelt werden.
        const normalizedQn = toKebab(hit.qn);
        if (knownQns.size > 0 && !knownQns.has(normalizedQn)) {
          violations.push({
            file: path.relative(ROOT, filePath),
            line: hit.line,
            message: `unknown write handler: "${hit.qn}" — not found in feature-manifest.json`,
          });
        }
      }
    }

    // Info-Log wenn kein Manifest geladen wurde — kein Fehler, aber
    // der Guard läuft dann nur mit struktureller Prüfung.
    if (knownQnsByRepo.size === 0 && violations.length === 0) {
      console.warn(
        "  [INFO] No feature-manifest.json with writeHandlers found — structural check only.",
      );
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
