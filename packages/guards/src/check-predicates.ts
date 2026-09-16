#!/usr/bin/env bun
/**
 * Predicate-Extraction Check (WARNUNG, kein Fail).
 *
 * Findet zwei Arten von Kandidaten fuer Predicate-Extraction:
 *  1. Fat Predicates — `if`/`while`/ternary Conditions mit >=3 logischen
 *     Operatoren (&&/||) ODER Condition-Text >80 Zeichen.
 *  2. Duplikate — dieselbe Condition (normalisiert) >=2x im Scan-Scope,
 *     mit >=2 Operatoren (um triviale `!x`-Checks auszuschliessen).
 *
 * Output: Warnung mit Datei:Zeile + Hinweis auf Regel. Exit-Code immer 0.
 *
 * Usage:
 *   bun guards/check-predicates.ts
 *
 * Regel: ~/.claude/rules/coding-standards.md → "Predicate Extraction"
 */

import * as path from "node:path";
import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**"],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

const OPERATOR_THRESHOLD = 3;
const LENGTH_THRESHOLD = 80;
const DUP_MIN_OPERATORS = 2;

interface Site {
  file: string;
  line: number;
  text: string;
  operators: number;
  ands: number;
  ors: number;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Keywords/primitives we keep literal when building the structural shape.
// Everything else that looks like an identifier or property access collapses to `_`,
// so `toKebab(x) !== x` and `toKebab(y) !== y` share the same shape.
const SHAPE_KEEP = new Set([
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "void",
  "delete",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "string",
  "number",
  "object",
  "boolean",
  "symbol",
  "bigint",
  "function",
]);

function structuralShape(text: string): string {
  return text.replace(/\b[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*\b/g, (match) => {
    const dot = match.indexOf(".");
    const head = dot === -1 ? match : match.slice(0, dot);
    return SHAPE_KEEP.has(head) ? match : "_";
  });
}

function countOperators(text: string): { ands: number; ors: number } {
  const ands = (text.match(/&&/g) ?? []).length;
  const ors = (text.match(/\|\|/g) ?? []).length;
  return { ands, ors };
}

function collectConditions(sf: SourceFile): Site[] {
  const sites: Site[] = [];
  const file = path.relative(ROOT, sf.getFilePath());

  const push = (node: Node, conditionNode: Node | undefined): void => {
    if (!conditionNode) return;
    const raw = conditionNode.getText();
    const text = normalize(raw);
    const { ands, ors } = countOperators(text);
    const operators = ands + ors;
    if (operators === 0 && text.length < LENGTH_THRESHOLD) return;
    sites.push({
      file,
      line: node.getStartLineNumber(),
      text,
      operators,
      ands,
      ors,
    });
  };

  for (const ifNode of sf.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    push(ifNode, ifNode.getExpression());
  }
  for (const whileNode of sf.getDescendantsOfKind(SyntaxKind.WhileStatement)) {
    push(whileNode, whileNode.getExpression());
  }
  for (const tern of sf.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
    push(tern, tern.getCondition());
  }
  return sites;
}

// Warning-only Check: blockt nie (returnt immer 0 violations). Die Findings
// werden via console ausgegeben; der Runner zeigt `✓` solange nichts wirft.
export const guard: AstGuard = {
  name: "Predicate Extraction Check",
  scan: SCAN,
  run(files) {
    const allSites: Site[] = [];
    let scanned = 0;
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      scanned++;
      allSites.push(...collectConditions(sf));
    }

    const fatSites = allSites.filter(
      (s) => s.operators >= OPERATOR_THRESHOLD || s.text.length >= LENGTH_THRESHOLD,
    );

    const byText = new Map<string, Site[]>();
    const byShape = new Map<string, Site[]>();
    for (const s of allSites) {
      // Count as duplicate candidate if either >=2 operators OR text long enough
      // that repetition is still worth extracting (covers 1-operator but lengthy
      // domain checks like kebab-case validation).
      if (s.operators < DUP_MIN_OPERATORS && s.text.length < LENGTH_THRESHOLD) continue;
      const textBucket = byText.get(s.text) ?? [];
      textBucket.push(s);
      byText.set(s.text, textBucket);
      const shape = structuralShape(s.text);
      const shapeBucket = byShape.get(shape) ?? [];
      shapeBucket.push(s);
      byShape.set(shape, shapeBucket);
    }
    const textDups: Array<[Site, Site, ...Site[]]> = [];
    for (const bucket of byText.values()) {
      if (bucket.length < 2) continue;
      const [first, second, ...rest] = bucket;
      if (first !== undefined && second !== undefined) textDups.push([first, second, ...rest]);
    }
    const shapeDups: Array<{ shape: string; sites: Site[] }> = [];
    for (const [shape, bucket] of byShape.entries()) {
      if (bucket.length < 2) continue;
      // Skip when sites are already covered by exact-text duplicate group.
      const firstText = bucket[0]?.text;
      const allSame = bucket.every((s) => s.text === firstText);
      if (allSame) continue;
      shapeDups.push({ shape, sites: bucket });
    }

    console.log(`Predicate-Extraction Check: ${scanned} files checked.`);
    console.log(
      `  Fat predicates (>=${OPERATOR_THRESHOLD} ops or >${LENGTH_THRESHOLD} chars): ${fatSites.length}`,
    );
    console.log(`  Exact duplicates: ${textDups.length}`);
    console.log(`  Structural duplicates (same pattern, different names): ${shapeDups.length}`);

    if (fatSites.length === 0 && textDups.length === 0 && shapeDups.length === 0) {
      console.log("  Nothing to report.");
      return { violations: [] };
    }

    const snip = (text: string): string => (text.length > 90 ? `${text.slice(0, 87)}...` : text);

    if (fatSites.length > 0) {
      console.log(`\n  Fat-predicate candidates:`);
      for (const s of fatSites) {
        const hint = s.ands === 0 && s.ors >= 3 ? "  (Array.includes/Set?)" : "";
        console.log(`    ${s.file}:${s.line}  [${s.ands}&& ${s.ors}||]  ${snip(s.text)}${hint}`);
      }
    }

    if (textDups.length > 0) {
      console.log(`\n  Exact duplicates:`);
      for (const group of textDups) {
        const [first] = group;
        console.log(`    ${group.length}x  ${snip(first.text)}`);
        for (const s of group) console.log(`      - ${s.file}:${s.line}`);
      }
    }

    if (shapeDups.length > 0) {
      console.log(`\n  Structural duplicates:`);
      for (const { shape, sites } of shapeDups) {
        console.log(`    ${sites.length}x  shape: ${snip(shape)}`);
        for (const s of sites) console.log(`      - ${s.file}:${s.line}  ${snip(s.text)}`);
      }
    }

    console.log(
      "\n  Rule: extract as a named function (isX/hasY/canZ) when the condition has a stable name.",
    );
    console.log("  Warning, no fail.");
    return { violations: [] };
  },
};

if (import.meta.main) runStandalone(guard);
