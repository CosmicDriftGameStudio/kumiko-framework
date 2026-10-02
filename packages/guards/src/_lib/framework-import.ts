import * as path from "node:path";
import { type Node, SyntaxKind } from "ts-morph";

const FRAMEWORK_PACKAGE = "@cosmicdrift/kumiko-framework";
// Inside the framework monorepo itself the helpers are imported relatively,
// so a relative specifier counts when it resolves into the framework package.
const FRAMEWORK_SOURCE_DIR_MARKER = "/packages/framework/src/";

function isFrameworkModuleSpecifier(specifier: string, importingFile: string): boolean {
  if (specifier === FRAMEWORK_PACKAGE || specifier.startsWith(`${FRAMEWORK_PACKAGE}/`)) {
    return true;
  }
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(importingFile), specifier);
  return `${resolved}/`.includes(FRAMEWORK_SOURCE_DIR_MARKER);
}

// A text match on a function name lets a same-named local no-op clear an
// escape-hatch finding, so the identifier must resolve to an import of
// `exportedName` from the framework package. Aliased imports resolve too.
export function isFrameworkImportOf(node: Node, exportedName: string): boolean {
  if (!node.isKind(SyntaxKind.Identifier)) return false;
  const decls = node.getSymbol()?.getDeclarations() ?? [];
  return decls.some((decl) => {
    if (!decl.isKind(SyntaxKind.ImportSpecifier) || decl.getName() !== exportedName) return false;
    const specifier = decl.getImportDeclaration().getModuleSpecifierValue();
    return isFrameworkModuleSpecifier(specifier, decl.getSourceFile().getFilePath());
  });
}
