#!/usr/bin/env bun
/**
 * Guard: i18n-Keys muessen definiert sein, bevor sie verwendet werden.
 *
 * Scan: t()-Calls in App-tsx, Definitionen aus r.translations und i18n-Bundles.
 * Deklarative Screen-/Nav-Keys: validateBoot (Runtime).
 *
 * Usage:
 *   bun guards/guard-i18n-keys.ts
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { type Node, type ObjectLiteralExpression, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardOutcome, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**", "samples/apps/*/src/**", "samples/recipes/*/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;

interface UsedKey {
  key: string;
  file: string;
  line: number;
}

interface DefinedKey {
  fullKey: string;
  locales: Set<string>;
  file: string;
  line: number;
}

function relFile(sf: SourceFile): string {
  return path.relative(ROOT, sf.getFilePath());
}

function featureFromPath(filePath: string): string | null {
  const rel = path.relative(ROOT, filePath);
  const m = rel.match(/src\/features\/([^/]+)\//);
  return m?.[1] ?? null;
}

function isI18nBundleFile(filePath: string): boolean {
  return (
    /\/i18n\//.test(filePath) ||
    // Flat single-file bundle (src/i18n.ts), same status as src/i18n/index.ts.
    /\/i18n\.ts$/.test(filePath) ||
    /\/features\/[^/]+\/i18n\./.test(filePath) ||
    // Deckt beliebige Tiefe unter bundled-features/src/<feature>/ ab
    // (z.B. auch .../schema/i18n.ts), statt nur genau eine Ebene.
    /bundled-features\/src\/.*\/i18n\.ts$/.test(filePath)
  );
}

function collectUsedKeys(sf: SourceFile): UsedKey[] {
  const keys: UsedKey[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText();
    if (exprText !== "t" && !/(^|\.)t$/.test(exprText)) continue;
    if (exprText === "test" || exprText === "expect") continue;
    const args = call.getArguments();
    if (args.length === 0) continue;
    const first = args[0];
    if (
      !first?.isKind(SyntaxKind.StringLiteral) &&
      !first?.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
    )
      continue;
    const literal = first.getText().slice(1, -1);
    if (!literal.includes(":")) continue;
    keys.push({
      key: literal,
      file: relFile(sf),
      line: call.getStartLineNumber(),
    });
  }
  return keys;
}

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

function extractKeysFromTranslationsObject(
  obj: ObjectLiteralExpression,
): Array<{ key: string; locales: Set<string>; line: number }> {
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
      if (localeName.isKind(SyntaxKind.StringLiteral))
        locales.add(localeName.getText().slice(1, -1));
      else if (localeName.isKind(SyntaxKind.Identifier)) locales.add(localeName.getText());
    }
    out.push({ key: keyName, locales, line: prop.getStartLineNumber() });
  }
  return out;
}

function extractLocaleFirstKeys(
  obj: ObjectLiteralExpression,
): Array<{ key: string; locales: Set<string>; line: number }> {
  const localeMaps = new Map<string, ObjectLiteralExpression>();
  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    const localeName = prop.getNameNode().getText();
    const init = prop.getInitializer();
    if (init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
      localeMaps.set(localeName, init);
    }
  }
  if (!localeMaps.has("de") && !localeMaps.has("en")) return [];

  const keySet = new Set<string>();
  for (const map of localeMaps.values()) {
    for (const prop of map.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
      const nameNode = prop.getNameNode();
      if (nameNode.isKind(SyntaxKind.StringLiteral)) {
        keySet.add(nameNode.getText().slice(1, -1));
      }
    }
  }

  const out: Array<{ key: string; locales: Set<string>; line: number }> = [];
  for (const key of keySet) {
    const locales = new Set<string>();
    for (const [locale, map] of localeMaps) {
      const has = map.getProperties().some((prop) => {
        if (!prop.isKind(SyntaxKind.PropertyAssignment)) return false;
        const nameNode = prop.getNameNode();
        return nameNode.isKind(SyntaxKind.StringLiteral) && nameNode.getText().slice(1, -1) === key;
      });
      if (has) locales.add(locale);
    }
    out.push({ key, locales, line: obj.getStartLineNumber() });
  }
  return out;
}

function pushDefined(
  defined: DefinedKey[],
  fullKey: string,
  locales: Set<string>,
  file: string,
  line: number,
): void {
  defined.push({ fullKey, locales, file, line });
}

function addDefinedEntries(
  defined: DefinedKey[],
  entries: Array<{ key: string; locales: Set<string>; line: number }>,
  file: string,
  featureName: string | null,
): void {
  for (const entry of entries) {
    if (entry.key.includes(":")) {
      pushDefined(defined, entry.key, entry.locales, file, entry.line);
      continue;
    }
    if (featureName) {
      pushDefined(defined, `${featureName}:${entry.key}`, entry.locales, file, entry.line);
    }
  }
}

function objectLiteralFromInitializer(node: Node | undefined): ObjectLiteralExpression | undefined {
  if (!node) return undefined;
  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) return node;
  if (
    node.isKind(SyntaxKind.AsExpression) ||
    node.isKind(SyntaxKind.ParenthesizedExpression) ||
    node.isKind(SyntaxKind.SatisfiesExpression)
  ) {
    return objectLiteralFromInitializer(node.getExpression());
  }
  return undefined;
}

function isLocaleFirstBundle(obj: ObjectLiteralExpression): boolean {
  const props = obj.getProperties().filter((p) => p.isKind(SyntaxKind.PropertyAssignment));
  if (props.length === 0) return false;
  const localeRe = /^(de|en|fr|es|it|nl|pt)$/;
  return props.every((p) => localeRe.test(p.getNameNode().getText()));
}

function collectBundleDefinedKeys(sf: SourceFile): DefinedKey[] {
  const filePath = sf.getFilePath();
  if (!isI18nBundleFile(filePath)) return [];

  const defined: DefinedKey[] = [];
  const featureName = featureFromPath(filePath);

  for (const decl of sf.getVariableDeclarations()) {
    const obj = objectLiteralFromInitializer(decl.getInitializer());
    if (!obj) continue;

    if (isLocaleFirstBundle(obj)) {
      addDefinedEntries(defined, extractLocaleFirstKeys(obj), relFile(sf), featureName);
      continue;
    }

    const keyFirst = extractKeysFromTranslationsObject(obj);
    if (keyFirst.length > 0) {
      addDefinedEntries(defined, keyFirst, relFile(sf), featureName);
    }
  }

  return defined;
}

function collectInlineTranslationsDefinedKeys(sf: SourceFile): DefinedKey[] {
  const defined: DefinedKey[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!expr.getText().endsWith(".translations")) continue;
    const args = call.getArguments();
    const first = args[0];
    if (!first?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

    const featureName = findEnclosingFeatureName(call);
    if (!featureName) continue;

    for (const prop of first.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
      if (prop.getNameNode().getText() !== "keys") continue;
      const initializer = prop.getInitializer();
      if (initializer?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        for (const entry of extractKeysFromTranslationsObject(initializer)) {
          pushDefined(
            defined,
            `${featureName}:${entry.key}`,
            entry.locales,
            relFile(sf),
            entry.line,
          );
          if (entry.key.includes(":")) {
            pushDefined(defined, entry.key, entry.locales, relFile(sf), entry.line);
          }
        }
      } else if (initializer?.isKind(SyntaxKind.Identifier)) {
        // getDefinitionNodes() follows "go to definition" through an
        // import alias to the real declaration (possibly in another
        // file) instead of stopping at the ImportSpecifier — plain
        // getSymbol().getDeclarations() only resolved a same-file const.
        const decl = initializer
          .getDefinitionNodes()
          .find((n) => n.isKind(SyntaxKind.VariableDeclaration));
        if (decl?.isKind(SyntaxKind.VariableDeclaration)) {
          const bundleInit = decl.getInitializer();
          if (bundleInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            for (const entry of extractKeysFromTranslationsObject(bundleInit)) {
              addDefinedEntries(defined, [entry], relFile(sf), featureName);
            }
          }
        }
      }
    }
  }
  return defined;
}

/** Framework monorepo ships English-only core bundles; locale packages opt in separately. */
export function isFrameworkMonorepo(root: string): boolean {
  return existsSync(path.join(root, "packages/framework/package.json"));
}

/** Parse `export const NAME = [...]` locale literals. Returns null if absent;
 *  throws if the export exists but is not a static string-literal array
 *  (spread / alias / region-tag-only without literals) — silent de/en fallback
 *  would hide a real declaration (infra#602). */
export function parseLocaleConstArray(source: string, constName: string): string[] | null {
  const exportRe = new RegExp(`export\\s+const\\s+${constName}\\s*(?::[^=]+)?=\\s*([^;]+)`);
  const match = source.match(exportRe);
  if (!match?.[1]) return null;
  const rhs = match[1].trim();
  if (!rhs.startsWith("[")) {
    throw new Error(
      `i18n-keys: export const ${constName} is not a static array literal — refuse silent de/en fallback`,
    );
  }
  if (rhs.includes("...")) {
    throw new Error(
      `i18n-keys: export const ${constName} uses array spreads — refuse partial/silent locale set`,
    );
  }
  const locales = [...rhs.matchAll(/["']([a-z]{2}(?:-[A-Z]{2})?)["']/g)]
    .map((m) => m[1])
    .filter((l): l is string => l !== undefined);
  if (locales.length === 0) {
    throw new Error(
      `i18n-keys: export const ${constName} = [...] has no string locale literals — refuse silent de/en fallback`,
    );
  }
  return locales;
}

/** Resolve owning repo root from a guard-relative path (may be `../…`). */
export function repoRootForRelFile(rel: string): string {
  const abs = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
  let curr = path.dirname(abs);
  let fallback: string | undefined;
  while (curr !== path.dirname(curr)) {
    const base = path.basename(curr);
    // Never treat worktree/parent markers as a repo root (infra#602).
    if (base === ".." || base === ".wt") {
      curr = path.dirname(curr);
      continue;
    }
    if (existsSync(path.join(curr, "packages/framework/package.json"))) {
      return curr;
    }
    if (existsSync(path.join(curr, "package.json"))) {
      // Outermost package.json wins so nested packages/* resolve to the repo.
      fallback = curr;
    }
    curr = path.dirname(curr);
  }
  return fallback ?? ROOT;
}
/** Repo-declared locales for translation completeness; empty set skips the check. */
export function resolveExpectedLocales(root: string = ROOT): Set<string> {
  if (isFrameworkMonorepo(root)) return new Set();

  const declPaths: Array<{ rel: string; constName: string }> = [
    { rel: "src/i18n-guard-locales.ts", constName: "I18N_GUARD_LOCALES" },
    { rel: "src/marketing/locale-routes.ts", constName: "LOCALES" },
  ];
  for (const { rel, constName } of declPaths) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    const locales = parseLocaleConstArray(readFileSync(abs, "utf-8"), constName);
    if (locales) return new Set(locales);
    // parseLocaleConstArray throws on unreadable decls; null = no export.
  }
  return new Set(["de", "en"]);
}

export type I18nKeysRunOptions = {
  /** Inject expected locales per owning root — tests must not rely on process.cwd(). */
  readonly expectedLocalesForRoot?: (root: string) => Set<string>;
};

export function checkI18nKeys(
  files: readonly SourceFile[],
  options: I18nKeysRunOptions = {},
): GuardOutcome {
  const usedKeys: UsedKey[] = [];
  const definedKeys: DefinedKey[] = [];

  for (const sf of files) {
    const filePath = sf.getFilePath();
    if (EXCLUDE.test(filePath)) continue;
    usedKeys.push(...collectUsedKeys(sf));
    definedKeys.push(...collectInlineTranslationsDefinedKeys(sf));
    definedKeys.push(...collectBundleDefinedKeys(sf));
  }

  const definedSet = new Set(definedKeys.map((d) => d.fullKey));
  const missing = usedKeys.filter((u) => !definedSet.has(u.key));
  const resolveLocales = options.expectedLocalesForRoot ?? resolveExpectedLocales;
  const expectedByRoot = new Map<string, Set<string>>();
  const expectedForFile = (rel: string): Set<string> => {
    const root = repoRootForRelFile(rel);
    let locales = expectedByRoot.get(root);
    if (!locales) {
      locales = resolveLocales(root);
      expectedByRoot.set(root, locales);
    }
    return locales;
  };

  const localeViolations = definedKeys.flatMap((d) => {
    const expectedLocales = expectedForFile(d.file);
    const missingLocales = [...expectedLocales].filter((l) => !d.locales.has(l));
    if (missingLocales.length === 0) return [];
    return [
      {
        file: d.file,
        line: d.line,
        message: `Key "${d.fullKey}" is missing locale: ${missingLocales.join(", ")}`,
      },
    ];
  });

  return {
    violations: [
      ...missing.map((m) => ({
        file: m.file,
        line: m.line,
        message: `used key without a definition: "${m.key}"`,
      })),
      ...localeViolations,
    ],
  };
}

export const guard: AstGuard = {
  name: "i18n-Keys Guard",
  scan: SCAN,
  hint: "Used i18n key without a definition, or missing locale — add the key/locale to the feature's translations map (locales from src/i18n-guard-locales.ts or src/marketing/locale-routes.ts).",
  run(files) {
    return checkI18nKeys(files);
  },
};

if (import.meta.main) runStandalone(guard);
