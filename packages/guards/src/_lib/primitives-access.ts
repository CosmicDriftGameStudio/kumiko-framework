import type { SourceFile } from "ts-morph";

const RENDERER_WEB_MODULE = "@cosmicdrift/kumiko-renderer-web";

// Shared by every "raw HTML tag instead of framework primitive" guard
// (guard-no-custom-primitives, guard-raw-interactive-elements): proves the
// primitive set was reachable in this file — either an import from
// @cosmicdrift/kumiko-renderer-web (any symbol), or a `usePrimitives` named
// import, which lives in @cosmicdrift/kumiko-renderer (headless layer), not
// only in -web (see kumiko-enterprise/packages/ai-agent/src/web/turn-cards.tsx).
export function hasPrimitivesAccess(sf: SourceFile): boolean {
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() === RENDERER_WEB_MODULE) return true;
    if (imp.getNamedImports().some((named) => named.getName() === "usePrimitives")) {
      return true;
    }
  }
  return false;
}
