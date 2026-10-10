#!/usr/bin/env bun
/**
 * Guard: app mount points must register the German locale feature
 * when the repo depends on @cosmicdrift/kumiko-locale-de.
 *
 * guard-i18n-keys.ts only checks whether a used t() key is defined —
 * and has no concept of a "mount point". A mount that never calls
 * localeDeClient() (client) or localeDe() (server) slips through there
 * completely (kumiko-studio#191, publicstatus#365, infra#533).
 *
 * Scope gate: the package.json closest to the file must point at
 * kumiko-locale-de (currently kumiko-studio, publicstatus, solon,
 * offlot-app) — a node-resolution walk over ts-morph's FileSystemHost instead
 * of guards/_lib/roots.ts' sibling-repo list, so the gate also fires in the
 * in-memory test of the guard suite (no real sibling checkout).
 *
 * Usage:
 *   bun guards/guard-i18n-locale-mount.ts
 */

import { dirname, join } from "node:path";
import {
  type FileSystemHost,
  type Identifier,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const LOCALE_DE_DEP = "@cosmicdrift/kumiko-locale-de";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  kinds: ["library", "app"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;

const MOUNT_FACTORY_NAMES = new Set(["createKumikoApp", "createPublicSurface"]);

export function nearestPackageJson(fs: FileSystemHost, fromDir: string): string | undefined {
  let dir = fromDir;
  for (let i = 0; i < 40; i++) {
    const candidate = join(dir, "package.json");
    if (fs.fileExistsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

export function hasLocaleDeDependency(fs: FileSystemHost, pkgPath: string): boolean {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return false;
  }
  return LOCALE_DE_DEP in (pkg.dependencies ?? {}) || LOCALE_DE_DEP in (pkg.devDependencies ?? {});
}

type Gate = { readonly pkgPath: string; readonly gated: boolean };

function gateFor(sf: SourceFile, cache: Map<string, Gate>): Gate | undefined {
  const fs = sf.getProject().getFileSystem();
  const pkgPath = nearestPackageJson(fs, dirname(sf.getFilePath()));
  if (pkgPath === undefined) return undefined;
  const cached = cache.get(pkgPath);
  if (cached !== undefined) return cached;
  const gate: Gate = { pkgPath, gated: hasLocaleDeDependency(fs, pkgPath) };
  cache.set(pkgPath, gate);
  return gate;
}

// localeDeClient() (clientFeatures) matcht per Call-Text; `{ de: ... }` deckt
// die rohe <LocaleProvider fallbackBundles={[{ de: bundle }, ...]}>-Komposition
// ab, die keinen localeDeClient()-Call verwendet.
function localeDeClientRef(node: Node): boolean {
  if (node.isKind(SyntaxKind.Identifier) && node.getText() === "localeDeClient") return true;
  if (node.isKind(SyntaxKind.CallExpression)) return localeDeClientRef(node.getExpression());
  if (node.isKind(SyntaxKind.PropertyAccessExpression))
    return localeDeClientRef(node.getExpression());
  return false;
}

// Go-to-definition resolves an import binding all the way to its real
// VariableDeclaration in one hop — except a ShorthandPropertyAssignment's name
// node, which resolves only to the ImportSpecifier and needs a second hop
// through the specifier's own name to get there.
function resolveDeclaration(identifier: Identifier, depth = 0): Node | undefined {
  if (depth > 3) return undefined;
  // With a contextual type (e.g. a declared options type) the first definition
  // can be the property signature, not the binding — pick the binding.
  const def = identifier
    .getDefinitionNodes()
    .find(
      (node) =>
        node.isKind(SyntaxKind.VariableDeclaration) || node.isKind(SyntaxKind.ImportSpecifier),
    );
  if (def === undefined) return undefined;
  if (def.isKind(SyntaxKind.VariableDeclaration)) return def;
  if (def.isKind(SyntaxKind.ImportSpecifier)) {
    const specName = def.getNameNode();
    return specName.isKind(SyntaxKind.Identifier)
      ? resolveDeclaration(specName, depth + 1)
      : undefined;
  }
  return undefined;
}

// `as const` and `as const satisfies T[]` (both in active use, e.g.
// kumiko-studio's run-config.ts) wrap the array literal in an AsExpression
// and/or SatisfiesExpression, and `(X as T)` adds a ParenthesizedExpression —
// unwrap all of them so callers see the literal underneath.
function unwrapAsExpression(node: Node): Node {
  if (
    node.isKind(SyntaxKind.AsExpression) ||
    node.isKind(SyntaxKind.SatisfiesExpression) ||
    node.isKind(SyntaxKind.ParenthesizedExpression)
  ) {
    return unwrapAsExpression(node.getExpression());
  }
  return node;
}

// Scoped to the mount's own repo: in the shared multi-repo ts-morph Project
// the aggregate runner builds, a resolved declaration is only trusted when it
// lives under the same package.json root as the spreading/referencing file —
// never a same-named declaration from a different repo. Shared by array
// (`[...CONST]`) and object (`{ ...CONST }`) spread resolution alike.
function resolveSameRepoInitializer(identifier: Identifier): Node | undefined {
  const decl = resolveDeclaration(identifier);
  if (decl === undefined || !decl.isKind(SyntaxKind.VariableDeclaration)) return undefined;
  const fs = identifier.getSourceFile().getProject().getFileSystem();
  const originPkg = nearestPackageJson(fs, dirname(identifier.getSourceFile().getFilePath()));
  const targetPkg = nearestPackageJson(fs, dirname(decl.getSourceFile().getFilePath()));
  if (originPkg === undefined || originPkg !== targetPkg) return undefined;
  const init = decl.getInitializer();
  return init === undefined ? undefined : unwrapAsExpression(init);
}

// Bounds every alias/spread chain the guard follows; circular constants
// (`const a = [...b]; const b = [...a]`) parse fine and must end in a verdict,
// not a stack overflow.
const MAX_ALIAS_DEPTH = 5;

// Resolves an array-shaped value node down to its elements, whether it's a
// literal right there or an identifier pointing at a same-repo constant
// (`const CONST = [...]`, `... as const` included).
function arrayElementsOf(value: Node | undefined, depth = 0): Node[] | undefined {
  if (value === undefined || depth > MAX_ALIAS_DEPTH) return undefined;
  if (value.isKind(SyntaxKind.ArrayLiteralExpression)) return value.getElements();
  if (value.isKind(SyntaxKind.Identifier)) {
    return arrayElementsOf(resolveSameRepoInitializer(value), depth + 1);
  }
  return undefined;
}

// Past the depth bound the answer is "no German found" (fail-closed).
function elementRegistersGerman(el: Node, depth = 0): boolean {
  if (depth > MAX_ALIAS_DEPTH) return false;
  if (el.isKind(SyntaxKind.SpreadElement)) {
    const expr = el.getExpression();
    if (expr.isKind(SyntaxKind.Identifier)) {
      const init = resolveSameRepoInitializer(expr);
      if (init !== undefined) return elementRegistersGerman(init, depth + 1);
      // Unresolvable or cross-repo identifier spread — fail-open rather than risk a false alarm.
      // Safe here: clientFeatures is already known to exist as an array, this only concerns
      // one of its elements — other elements are still checked.
      return true;
    }
    return elementRegistersGerman(expr, depth + 1);
  }
  if (el.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return el.getElements().some((element) => elementRegistersGerman(element, depth + 1));
  }
  // localeDeClient().translations (kumiko-studio auth-mount shape)
  if (el.isKind(SyntaxKind.PropertyAccessExpression)) {
    return localeDeClientRef(el) || elementRegistersGerman(el.getExpression(), depth + 1);
  }
  if (el.isKind(SyntaxKind.CallExpression)) {
    return localeDeClientRef(el.getExpression());
  }
  if (el.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return el
      .getProperties()
      .some((p) => p.isKind(SyntaxKind.PropertyAssignment) && p.getNameNode().getText() === "de");
  }
  return false;
}

function jsxTagNameOf(attr: Node): string | undefined {
  const el = attr.getParent()?.getParent();
  if (el?.isKind(SyntaxKind.JsxOpeningElement)) return el.getTagNameNode().getText();
  if (el?.isKind(SyntaxKind.JsxSelfClosingElement)) return el.getTagNameNode().getText();
  return undefined;
}

// `clientFeatures: [...]`, `clientFeatures,` (shorthand) and `clientFeatures: clientFeatures`
// all reference the same array — resolve the value node down to its elements either way.
function clientFeaturesElements(prop: Node | undefined): Node[] | undefined {
  const value = prop?.isKind(SyntaxKind.PropertyAssignment)
    ? prop.getInitializer()
    : prop?.isKind(SyntaxKind.ShorthandPropertyAssignment)
      ? prop.getNameNode()
      : undefined;
  return arrayElementsOf(value);
}

type ClientFeaturesLookup =
  | { readonly found: false }
  | { readonly found: true; readonly registersGerman: boolean };

const CLIENT_FEATURES_ABSENT: ClientFeaturesLookup = { found: false };
// An options source the guard cannot see into could hold (or override) clientFeatures —
// unlike a single array element, treating it as "German registered" would blind the guard.
const CLIENT_FEATURES_UNRESOLVABLE: ClientFeaturesLookup = { found: true, registersGerman: false };

// `cond && {…}` and `cond ? {…} : {…}` spread one of their object branches (or nothing).
function conditionalBranches(node: Node): Node[] | undefined {
  if (node.isKind(SyntaxKind.ConditionalExpression))
    return [node.getWhenTrue(), node.getWhenFalse()];
  if (
    node.isKind(SyntaxKind.BinaryExpression) &&
    node.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
  ) {
    return [node.getRight()];
  }
  return undefined;
}

// Spreading these contributes no properties.
function isNothingLiteral(node: Node): boolean {
  return (
    node.isKind(SyntaxKind.NullKeyword) ||
    node.isKind(SyntaxKind.FalseKeyword) ||
    (node.isKind(SyntaxKind.Identifier) && node.getText() === "undefined")
  );
}

// Finds the clientFeatures property that wins at runtime in the mount call's
// options — a literal right there, or an identifier pointing at a same-repo
// constant (offlot's `APP_OPTIONS` shape). Properties are walked last to
// first, mirroring object-spread override semantics: the last property or
// spread that sets `clientFeatures` decides. Resolvable spreads without
// `clientFeatures` are skipped; unresolvable/cross-repo ones are fail-closed.
function lookupClientFeatures(value: Node | undefined, depth = 0): ClientFeaturesLookup {
  if (value === undefined) return CLIENT_FEATURES_ABSENT;
  if (depth > MAX_ALIAS_DEPTH) return CLIENT_FEATURES_UNRESOLVABLE;
  const unwrapped = unwrapAsExpression(value);
  if (unwrapped.isKind(SyntaxKind.Identifier)) {
    const init = resolveSameRepoInitializer(unwrapped);
    return init === undefined
      ? CLIENT_FEATURES_UNRESOLVABLE
      : lookupClientFeatures(init, depth + 1);
  }
  const branches = conditionalBranches(unwrapped);
  if (branches !== undefined) {
    const found = branches
      .map((branch) => lookupClientFeatures(branch, depth + 1))
      .filter((lookup) => lookup.found);
    if (found.length === 0) return CLIENT_FEATURES_ABSENT;
    // Which branch runs is unknown statically: German must be registered in every branch that sets clientFeatures.
    return {
      found: true,
      registersGerman: found.every((lookup) => lookup.found && lookup.registersGerman),
    };
  }
  if (isNothingLiteral(unwrapped)) return CLIENT_FEATURES_ABSENT;
  if (!unwrapped.isKind(SyntaxKind.ObjectLiteralExpression)) return CLIENT_FEATURES_UNRESOLVABLE;
  for (const prop of [...unwrapped.getProperties()].reverse()) {
    if (
      (prop.isKind(SyntaxKind.PropertyAssignment) ||
        prop.isKind(SyntaxKind.ShorthandPropertyAssignment)) &&
      prop.getNameNode().getText() === "clientFeatures"
    ) {
      return {
        found: true,
        registersGerman:
          clientFeaturesElements(prop)?.some((el) => elementRegistersGerman(el)) ?? false,
      };
    }
    if (prop.isKind(SyntaxKind.SpreadAssignment)) {
      const spread = lookupClientFeatures(prop.getExpression(), depth + 1);
      if (spread.found) return spread;
    }
  }
  return CLIENT_FEATURES_ABSENT;
}

function objectRegistersGermanClientFeatures(value: Node | undefined): boolean {
  const lookup = lookupClientFeatures(value);
  return lookup.found && lookup.registersGerman;
}

function clientMountViolations(sf: SourceFile): GuardViolation[] {
  const violations: GuardViolation[] = [];

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!MOUNT_FACTORY_NAMES.has(call.getExpression().getText())) continue;
    const arg = call.getArguments()[0];
    const registered = objectRegistersGermanClientFeatures(arg);
    if (!registered) {
      violations.push({
        file: sf.getFilePath(),
        line: call.getStartLineNumber(),
        message: `Mount point "${call.getExpression().getText()}(...)" does not register a German locale feature (localeDeClient() missing in clientFeatures) — repo depends on ${LOCALE_DE_DEP}.`,
      });
    }
  }

  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attr.getNameNode().getText() !== "fallbackBundles") continue;
    if (jsxTagNameOf(attr) !== "LocaleProvider") continue;
    const init = attr.getInitializer();
    const expr = init?.isKind(SyntaxKind.JsxExpression) ? init.getExpression() : undefined;
    const elements = arrayElementsOf(expr);
    const registered = elements?.some((el) => elementRegistersGerman(el)) ?? false;
    if (!registered) {
      violations.push({
        file: sf.getFilePath(),
        line: attr.getStartLineNumber(),
        message: `<LocaleProvider fallbackBundles={...}> does not register a German locale bundle ({ de: ... }) — repo depends on ${LOCALE_DE_DEP}.`,
      });
    }
  }

  return violations;
}

function hasServerLocaleCall(sf: SourceFile): boolean {
  return sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((c) => c.getExpression().getText() === "localeDe");
}

export function findViolations(files: readonly SourceFile[]): GuardViolation[] {
  const relevant = files.filter((sf) => !EXCLUDE.test(sf.getFilePath()));
  const cache = new Map<string, Gate>();
  const serverCallSeen = new Set<string>();

  const violations: GuardViolation[] = [];
  for (const sf of relevant) {
    const gate = gateFor(sf, cache);
    if (gate === undefined || !gate.gated) continue;
    violations.push(...clientMountViolations(sf));
    if (hasServerLocaleCall(sf)) serverCallSeen.add(gate.pkgPath);
  }

  const gatedPkgPaths = new Set([...cache.values()].filter((g) => g.gated).map((g) => g.pkgPath));
  for (const pkgPath of gatedPkgPaths) {
    if (serverCallSeen.has(pkgPath)) continue;
    violations.push({
      file: pkgPath,
      line: 1,
      message: `Repo depends on ${LOCALE_DE_DEP}, but no server-side localeDe() call was found — German mail templates (registerMailTranslations) are not registered.`,
    });
  }

  return violations;
}

export const guard: AstGuard = {
  name: "i18n-Locale-Mount Guard",
  scan: SCAN,
  hint: "Mount point (createKumikoApp/createPublicSurface/LocaleProvider) without a German locale feature — add localeDeClient() to clientFeatures, or localeDe() to the server feature list.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    const violations = findViolations(files)
      .map((v) => ({ ...v, file: relFromRepoRoot(v.file, roots) }))
      .filter(isLocalFinding);
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
