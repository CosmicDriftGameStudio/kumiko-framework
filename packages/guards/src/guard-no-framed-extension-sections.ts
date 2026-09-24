#!/usr/bin/env bun
// Extension-section components (registered via a ClientFeatureDefinition's
// `extensionSectionComponents`) are mounted inside RenderEdit's own section
// frame (Section in standalone screens, Card in tabs mode — see
// render-edit.tsx). A registered component that renders its own
// Card/SectionCard/CollapsibleSection nests a second card inside that frame
// — double border/padding, exactly what the projectionDetail/entityEdit-tabs
// unification (framework issue about single-card section framing) removes.
//
// Scope: only components actually referenced as a value in an
// `extensionSectionComponents: { ... }` object literal — a component that is
// ALSO mountable standalone (its own doc/comment says so) keeps its own
// card chrome fine in that mode; this guard only catches it nesting a card
// INSIDE the extension-section render path.
//
// Resolution: the registered value is almost never declared in the same
// file as the registration (client-app.tsx imports it, often through a
// feature-folder barrel). We follow named/aliased/shorthand imports and
// `export { X } from "./y"` / `export * from "./y"` barrel re-exports
// across files (bounded by a visited-set + hop limit) to find the real
// JSX body, and we do the same one hop further for any capitalised JSX
// child the resolved body renders (a registered component that itself has
// no Card but delegates to a child component that does still double-frames).
// A module specifier that does not resolve to a project source file (a real
// external package import, e.g. `@cosmicdrift/kumiko-bundled-features/...`)
// is treated as "package component, already checked inside the package
// itself" and is not flagged here — the package's own source is in scope
// via `frameworkWithin` when this guard runs against the framework repo.

import * as path from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["tsx"],
  frameworkWithin: ["packages/bundled-features/src/**", "samples/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore no-framed-extension-sections";
const MAX_HOPS = 4;

const FRAMED_TAG = /^(Card|SectionCard|CollapsibleSection)$/;

// A vendored package's shipped .tsx source is still resolvable through
// node_modules — treat it the same as a truly unresolvable specifier
// ("package component, checked inside the package itself"), not as a hop
// into the App-Repo's own extension code.
function isExternalSourceFile(sf: SourceFile): boolean {
  return sf.getFilePath().includes("/node_modules/");
}

function findExtensionComponentNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (prop.getName() !== "extensionSectionComponents") continue;
    const init = prop.getInitializer();
    if (init === undefined || init.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    for (const member of init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties()) {
      // { NOTES_SECTION_EXTENSION_NAME: NotesSection } (PropertyAssignment,
      // possibly computed-key) or { NotesSection } (ShorthandPropertyAssignment).
      if (member.getKind() === SyntaxKind.PropertyAssignment) {
        const valueInit = member.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
        if (valueInit !== undefined && valueInit.getKind() === SyntaxKind.Identifier) {
          names.add(valueInit.getText());
        }
      } else if (member.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
        names.add(member.asKindOrThrow(SyntaxKind.ShorthandPropertyAssignment).getName());
      }
    }
  }
  return names;
}

function findLocalDeclaration(sf: SourceFile, name: string): Node[] {
  const fn = sf.getFunction(name);
  if (fn !== undefined) return [fn];
  const v = sf.getVariableDeclaration(name);
  if (v === undefined) return [];
  const init = v.getInitializer();
  return init !== undefined ? [init] : [];
}

type Resolved = { readonly sf: SourceFile; readonly nodes: readonly Node[] };

/** Resolves `exportedName` inside `sf`: a local declaration, or one hop
 *  through a barrel re-export (`export { X } from "./y"` / `export * from
 *  "./y"`). Returns undefined for an external (unresolvable) module or a
 *  dead end. */
function resolveExported(
  sf: SourceFile,
  exportedName: string,
  visited: Set<string>,
  hops: number,
): Resolved | "external" | undefined {
  const key = `${sf.getFilePath()}::export::${exportedName}`;
  if (visited.has(key) || hops > MAX_HOPS) return undefined;
  visited.add(key);

  const local = findLocalDeclaration(sf, exportedName);
  if (local.length > 0) return { sf, nodes: local };

  for (const exp of sf.getExportDeclarations()) {
    const targetSf = exp.getModuleSpecifierSourceFile();
    const namedExports = exp.getNamedExports();
    if (namedExports.length === 0) {
      // `export * from "./y"` — re-check the same name one module over.
      if (targetSf === undefined) continue;
      if (isExternalSourceFile(targetSf)) return "external";
      const res = resolveExported(targetSf, exportedName, visited, hops + 1);
      if (res !== undefined) return res;
      continue;
    }
    for (const named of namedExports) {
      const asName = named.getAliasNode()?.getText() ?? named.getName();
      if (asName !== exportedName) continue;
      if (targetSf === undefined || isExternalSourceFile(targetSf)) return "external";
      return resolveExported(targetSf, named.getName(), visited, hops + 1);
    }
  }
  return undefined;
}

/** Resolves `name` used inside `sf` (registration value or a JSX child tag)
 *  to its declaring file + body, following imports and barrels. */
function resolveComponent(
  sf: SourceFile,
  name: string,
  visited: Set<string>,
  hops: number,
): Resolved | "external" | undefined {
  const local = findLocalDeclaration(sf, name);
  if (local.length > 0) return { sf, nodes: local };
  if (hops > MAX_HOPS) return undefined;

  for (const imp of sf.getImportDeclarations()) {
    const defaultImport = imp.getDefaultImport();
    if (defaultImport !== undefined && defaultImport.getText() === name) {
      const targetSf = imp.getModuleSpecifierSourceFile();
      if (targetSf === undefined || isExternalSourceFile(targetSf)) return "external";
      return resolveExported(targetSf, "default", visited, hops + 1);
    }
    for (const named of imp.getNamedImports()) {
      const localName = named.getAliasNode()?.getText() ?? named.getName();
      if (localName !== name) continue;
      const targetSf = imp.getModuleSpecifierSourceFile();
      if (targetSf === undefined || isExternalSourceFile(targetSf)) return "external";
      return resolveExported(targetSf, named.getName(), visited, hops + 1);
    }
  }
  return undefined;
}

function jsxElements(nodes: readonly Node[]): Node[] {
  return nodes.flatMap((root) => [
    ...root.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...root.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ]);
}

type TaggedElement = { readonly el: Node; readonly tag: string };

function tagNameOf(el: Node): string {
  if (Node.isJsxOpeningElement(el) || Node.isJsxSelfClosingElement(el)) {
    return el.getTagNameNode().getText();
  }
  return "";
}

function taggedElements(nodes: readonly Node[]): TaggedElement[] {
  return jsxElements(nodes).map((el) => ({ el, tag: tagNameOf(el) }));
}

function collectFramedViolations(
  registeredName: string,
  resolved: Resolved,
  chain: readonly string[],
  visited: Set<string>,
  hops: number,
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  for (const { el, tag } of taggedElements(resolved.nodes)) {
    if (FRAMED_TAG.test(tag)) {
      if (hasIgnoreTag(el, IGNORE_TAG)) continue;
      const via = chain.length > 1 ? ` (via ${chain.join(" -> ")})` : "";
      violations.push({
        file: path.relative(ROOT, resolved.sf.getFilePath()),
        line: el.getStartLineNumber(),
        message: `Extension-section component "${registeredName}"${via} renders its own <${tag}> — the host already frames it in one card. Drop it (plain container / Heading), or if genuinely needed: // ${IGNORE_TAG} <reason>`,
      });
      continue;
    }
    if (hops >= MAX_HOPS || !/^[A-Z]/.test(tag)) continue;
    const child = resolveComponent(resolved.sf, tag, visited, hops + 1);
    if (child === undefined || child === "external") continue;
    violations.push(
      ...collectFramedViolations(registeredName, child, [...chain, tag], visited, hops + 1),
    );
  }
  return violations;
}

function analyse(files: readonly SourceFile[]): {
  violations: GuardViolation[];
} {
  const violations: GuardViolation[] = [];
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const registeredNames = findExtensionComponentNames(sf);
    if (registeredNames.size === 0) continue;
    for (const name of registeredNames) {
      const visited = new Set<string>();
      const resolved = resolveComponent(sf, name, visited, 0);
      if (resolved === undefined || resolved === "external") continue;
      violations.push(...collectFramedViolations(name, resolved, [name], visited, 0));
    }
  }
  return { violations };
}

export const guard: AstGuard = {
  name: "No-Framed-Extension-Sections Guard",
  scan: SCAN,
  hint:
    "An extension-section component registered via extensionSectionComponents is mounted inside the host's own Section/Card frame — it must not render a second Card/SectionCard/CollapsibleSection around its own content, directly or through a delegated child component. " +
    `Real exception: // ${IGNORE_TAG} <reason>`,
  run: (files) => analyse(files),
};

if (import.meta.main) {
  runStandalone(guard);
}
