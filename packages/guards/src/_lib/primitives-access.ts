import type { SourceFile } from "ts-morph";

const RENDERER_WEB_MODULES: ReadonlySet<string> = new Set([
  "@cosmicdrift/kumiko-renderer/web",
  "@cosmicdrift/kumiko-renderer-web",
]);

// Shared by every "raw HTML tag instead of framework primitive" guard
// (guard-no-custom-primitives, guard-raw-interactive-elements): proves the
// primitive set was reachable in this file — either an import from
// @cosmicdrift/kumiko-renderer/web (any symbol; the deprecated
// @cosmicdrift/kumiko-renderer-web shim counts too), or a `usePrimitives`
// named import, which lives in the shared layer of @cosmicdrift/kumiko-renderer,
// not only in /web (see kumiko-enterprise/packages/ai-agent/src/web/turn-cards.tsx).
export function hasPrimitivesAccess(sf: SourceFile): boolean {
  for (const imp of sf.getImportDeclarations()) {
    if (RENDERER_WEB_MODULES.has(imp.getModuleSpecifierValue())) return true;
    if (imp.getNamedImports().some((named) => named.getName() === "usePrimitives")) {
      return true;
    }
  }
  return false;
}
