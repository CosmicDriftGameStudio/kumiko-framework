/**
 * Guard: i18n-Keys muessen definiert sein, bevor sie verwendet werden. Ein
 * `i18n.t("user:greeting")`-Call ohne passendes `r.translations({ keys:
 * { greeting: { ... } } })` im "user"-Feature gibt zur Laufzeit einfach den
 * String-Key zurueck — der User sieht dann "user:greeting" statt "Willkommen".
 * Silent UX-Bug.
 *
 * Scan-Strategie:
 *   1. Im Prod-Code alle `t(...)` / `i18n.t(...)` Calls mit String-Literal-Key
 *      sammeln (dynamische Keys werden uebersprungen — nicht pruefbar).
 *   2. Alle `r.translations({ keys: {...} })` Bloecke sammeln, den enclosing
 *      `defineFeature("name", ...)` finden, Keys als "name:localKey" prefixen.
 *   3. Diff: benutzte Keys minus definierte Keys = fehlend.
 *   4. Zusatz: wenn ein Key in einer Locale definiert ist aber in anderen des
 *      gleichen Feature-Blocks fehlt → flag als Locale-Luecke.
 *
 * Usage:
 *   yarn tsx scripts/guard-i18n-keys.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type CallExpression, Node, type ObjectLiteralExpression, Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
];
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

interface UsedKey {
  key: string;
  file: string;
  line: number;
}

interface DefinedKey {
  fullKey: string; // "featureName:localKey"
  locales: Set<string>;
  file: string;
  line: number;
}

// Collect t(key) / i18n.t(key) string-literal usages
function collectUsedKeys(sf: SourceFile): UsedKey[] {
  const keys: UsedKey[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText();
    if (exprText !== "t" && !/(^|\.)t$/.test(exprText)) continue;
    if (exprText === "test" || exprText === "expect") continue; // false positives
    const args = call.getArguments();
    if (args.length === 0) continue;
    const first = args[0];
    if (!first?.isKind(SyntaxKind.StringLiteral) && !first?.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) continue;
    const literal = first.getText().slice(1, -1);
    if (!literal.includes(":")) continue; // unprefixed keys are dynamic helpers, skip
    keys.push({
      key: literal,
      file: path.relative(ROOT, sf.getFilePath()),
      line: call.getStartLineNumber(),
    });
  }
  return keys;
}

// Find the enclosing defineFeature("<name>", ...) call for a node
function findEnclosingFeatureName(node: Node): string | null {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (cur.isKind(SyntaxKind.CallExpression)) {
      const call = cur;
      if (call.getExpression().getText() === "defineFeature") {
        const first = call.getArguments()[0];
        if (first?.isKind(SyntaxKind.StringLiteral)) {
          return first.getText().slice(1, -1);
        }
      }
    }
    cur = cur.getParent();
  }
  return null;
}

// Walk an object literal of keys: { "greeting": { de: "...", en: "..." }, ... }
function extractKeysFromTranslationsObject(obj: ObjectLiteralExpression): Array<{ key: string; locales: Set<string>; line: number }> {
  const out: Array<{ key: string; locales: Set<string>; line: number }> = [];
  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    const nameNode = prop.getNameNode();
    let keyName: string;
    if (nameNode.isKind(SyntaxKind.StringLiteral)) {
      keyName = nameNode.getText().slice(1, -1);
    } else if (nameNode.isKind(SyntaxKind.Identifier)) {
      keyName = nameNode.getText();
    } else continue;

    const initializer = prop.getInitializer();
    if (!initializer?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    const locales = new Set<string>();
    for (const localeProp of initializer.getProperties()) {
      if (!localeProp.isKind(SyntaxKind.PropertyAssignment)) continue;
      const localeName = localeProp.getNameNode();
      if (localeName.isKind(SyntaxKind.StringLiteral)) locales.add(localeName.getText().slice(1, -1));
      else if (localeName.isKind(SyntaxKind.Identifier)) locales.add(localeName.getText());
    }
    out.push({ key: keyName, locales, line: prop.getStartLineNumber() });
  }
  return out;
}

function collectDefinedKeys(sf: SourceFile): DefinedKey[] {
  const defined: DefinedKey[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!expr.getText().endsWith(".translations")) continue;
    const args = call.getArguments();
    const first = args[0];
    if (!first?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

    const featureName = findEnclosingFeatureName(call);
    if (!featureName) continue; // can't resolve namespace

    // Find the inner "keys" property
    for (const prop of first.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
      const name = prop.getNameNode().getText();
      if (name !== "keys") continue;
      const initializer = prop.getInitializer();
      if (!initializer?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
      for (const entry of extractKeysFromTranslationsObject(initializer)) {
        defined.push({
          fullKey: `${featureName}:${entry.key}`,
          locales: entry.locales,
          file: path.relative(ROOT, sf.getFilePath()),
          line: entry.line,
        });
      }
    }
  }
  return defined;
}

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const usedKeys: UsedKey[] = [];
  const definedKeys: DefinedKey[] = [];

  for (const sf of project.getSourceFiles()) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    usedKeys.push(...collectUsedKeys(sf));
    definedKeys.push(...collectDefinedKeys(sf));
  }

  const definedSet = new Set(definedKeys.map((d) => d.fullKey));
  const missing = usedKeys.filter((u) => !definedSet.has(u.key));

  // Locale consistency: collect all locales seen globally, flag keys that skip any
  const allLocales = new Set<string>();
  for (const d of definedKeys) for (const l of d.locales) allLocales.add(l);
  const localeGaps: Array<{ key: string; missing: string[]; file: string; line: number }> = [];
  if (allLocales.size > 1) {
    for (const d of definedKeys) {
      const missingLocales = [...allLocales].filter((l) => !d.locales.has(l));
      if (missingLocales.length > 0) {
        localeGaps.push({ key: d.fullKey, missing: missingLocales, file: d.file, line: d.line });
      }
    }
  }

  console.log(
    `i18n Guard: ${usedKeys.length} Keys verwendet, ${definedKeys.length} definiert, ${allLocales.size} Locales insgesamt.`,
  );

  if (missing.length === 0 && localeGaps.length === 0) {
    console.log("  Alle Keys sauber definiert, Locales konsistent.");
    return;
  }

  if (missing.length > 0) {
    console.error(`\n  BLOCKED: ${missing.length} verwendete Keys ohne Definition:\n`);
    for (const m of missing) {
      console.error(`    ${m.file}:${m.line}  "${m.key}"`);
    }
  }
  if (localeGaps.length > 0) {
    console.error(`\n  WARNUNG: ${localeGaps.length} Keys mit fehlenden Locales:\n`);
    for (const g of localeGaps) {
      console.error(`    ${g.file}:${g.line}  "${g.key}" fehlt: ${g.missing.join(", ")}`);
    }
  }
  console.error("");
  if (missing.length > 0) process.exit(1);
}

main();
