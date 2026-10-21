#!/usr/bin/env bun
/**
 * Guard: i18n keys must be defined before they are used.
 *
 * Scan: t() calls in app tsx, definitions from r.translations and i18n bundles.
 * Declarative screen/nav keys and per-feature locale completeness: validateBoot (runtime).
 *
 * Usage:
 *   bun guards/guard-i18n-keys.ts
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  type Node,
  type ObjectLiteralExpression,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
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
    /\/i18n\.(ts|js)$/.test(filePath) ||
    /\/features\/[^/]+\/i18n\./.test(filePath) ||
    // Covers any depth below bundled-features/src/<feature>/
    // (e.g. also .../schema/i18n.ts), not just exactly one level.
    /bundled-features\/(src|dist)\/.*\/i18n\.(ts|js)$/.test(filePath)
  );
}

function collectUsedKeys(sf: SourceFile): UsedKey[] {
  const keys: UsedKey[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText();
    if (exprText !== "t" && !/(^|\.)t$/.test(exprText)) continue;
    const args = call.getArguments();
    if (args.length === 0) continue;
    const first = args[0];
    if (
      !first?.isKind(SyntaxKind.StringLiteral) &&
      !first?.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
    )
      continue;
    const literal = first.getLiteralText();
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
          return first.getLiteralText();
        }
      }
    }
    cur = cur.getParent();
  }
  return null;
}

type KeyEntry = { key: string; line: number };

function extractKeysFromTranslationsObject(obj: ObjectLiteralExpression): KeyEntry[] {
  const out: KeyEntry[] = [];
  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    const nameNode = prop.getNameNode();
    let keyName: string;
    if (nameNode.isKind(SyntaxKind.StringLiteral)) {
      keyName = nameNode.getLiteralText();
    } else if (nameNode.isKind(SyntaxKind.Identifier)) {
      keyName = nameNode.getText();
    } else continue;

    if (!prop.getInitializer()?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    out.push({ key: keyName, line: prop.getStartLineNumber() });
  }
  return out;
}

function extractLocaleFirstKeys(obj: ObjectLiteralExpression): KeyEntry[] {
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
        keySet.add(nameNode.getLiteralText());
      }
    }
  }

  return [...keySet].map((key) => ({ key, line: obj.getStartLineNumber() }));
}

function pushDefined(defined: DefinedKey[], fullKey: string, file: string, line: number): void {
  defined.push({ fullKey, file, line });
}

function addDefinedEntries(
  defined: DefinedKey[],
  entries: KeyEntry[],
  file: string,
  featureName: string | null,
): void {
  for (const entry of entries) {
    if (entry.key.includes(":")) {
      pushDefined(defined, entry.key, file, entry.line);
      continue;
    }
    if (featureName) {
      pushDefined(defined, `${featureName}:${entry.key}`, file, entry.line);
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

// Collects the entries of one `keys:` initializer of an inline `.translations({...})` call.
function collectInlineKeysInitializer(
  defined: DefinedKey[],
  initializer: Node | undefined,
  featureName: string,
  file: string,
): void {
  if (initializer?.isKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const entry of extractKeysFromTranslationsObject(initializer)) {
      pushDefined(defined, `${featureName}:${entry.key}`, file, entry.line);
      if (entry.key.includes(":")) {
        pushDefined(defined, entry.key, file, entry.line);
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
          addDefinedEntries(defined, [entry], file, featureName);
        }
      }
    }
  }
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
      collectInlineKeysInitializer(defined, prop.getInitializer(), featureName, relFile(sf));
    }
  }
  return defined;
}

/** Framework monorepo ships English-only core bundles; locale packages opt in separately. */
export function isFrameworkMonorepo(root: string): boolean {
  return existsSync(path.join(root, "packages/framework/package.json"));
}

// Published packages ship `dist` (compiled JS) only; workspace links also carry `src`.
const INSTALLED_FRAMEWORK_SOURCES = [
  "kumiko-*/{src,dist}/**/*.{ts,tsx,js}",
  "!kumiko-*/**/__tests__/**",
  "!kumiko-*/**/*.test.{ts,tsx,js}",
  "!kumiko-*/**/*.d.ts",
];

/** Every `node_modules/@cosmicdrift` from the app root upwards: Node resolves per package, so an app's own
 *  scope dir (a few linked packages) must not hide the hoisted one of the bun workspace above it. */
function findInstalledScopeDirs(root: string): string[] {
  const dirs: string[] = [];
  let curr = path.resolve(root);
  for (;;) {
    const candidate = path.join(curr, "node_modules/@cosmicdrift");
    if (existsSync(candidate)) dirs.push(candidate);
    const parent = path.dirname(curr);
    if (parent === curr) return dirs;
    curr = parent;
  }
}

/** Keys the installed framework packages define, so an app may use them without redefining. */
export function collectInstalledFrameworkKeys(root: string = ROOT): Set<string> {
  if (isFrameworkMonorepo(root)) return new Set();
  // allowJs: definition lookup through imports must follow into the compiled .js files.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });
  for (const scopeDir of findInstalledScopeDirs(root)) {
    project.addSourceFilesAtPaths(
      INSTALLED_FRAMEWORK_SOURCES.map((glob) =>
        glob.startsWith("!") ? `!${path.join(scopeDir, glob.slice(1))}` : path.join(scopeDir, glob),
      ),
    );
  }
  const keys = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    for (const entry of collectInlineTranslationsDefinedKeys(sf)) keys.add(entry.fullKey);
    for (const entry of collectBundleDefinedKeys(sf)) keys.add(entry.fullKey);
  }
  return keys;
}

export type I18nKeysRunOptions = {
  /** Inject the framework keys of the installed packages — tests must not scan node_modules. */
  readonly installedFrameworkKeys?: () => ReadonlySet<string>;
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
  const undefinedInApp = usedKeys.filter((u) => !definedSet.has(u.key));
  // Scanning node_modules is slow; only pay for it when a key is unresolved.
  const installedKeys =
    undefinedInApp.length === 0
      ? new Set<string>()
      : (options.installedFrameworkKeys ?? collectInstalledFrameworkKeys)();
  const missing = undefinedInApp.filter((u) => !installedKeys.has(u.key));
  return {
    violations: missing.map((m) => ({
      file: m.file,
      line: m.line,
      message: `used key without a definition: "${m.key}"`,
    })),
  };
}

export const guard: AstGuard = {
  name: "i18n-Keys Guard",
  scan: SCAN,
  hint: "Used i18n key without a definition — add the key to the feature's translations map.",
  run(files) {
    return checkI18nKeys(files);
  },
};

if (import.meta.main) runStandalone(guard);
