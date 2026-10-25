import { Node, type SourceFile } from "ts-morph";

const TEST_FRAMEWORK_MODULES: ReadonlySet<string> = new Set(["bun:test", "@playwright/test"]);

export const TEST_DECLARATION_CALLEE =
  /^(test|it|describe)(\.(skip|only|todo|if|each|failing|concurrent|serial|skipIf|runIf|todoIf))*$/;

// Maps local names imported from the test framework to their exported name;
// "" marks a namespace import (`import * as bt`), whose member access is stripped.
export function testFrameworkAliases(sf: SourceFile): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const decl of sf.getImportDeclarations()) {
    if (!TEST_FRAMEWORK_MODULES.has(decl.getModuleSpecifierValue())) continue;
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport !== undefined) aliases.set(namespaceImport.getText(), "");
    for (const named of decl.getNamedImports()) {
      const alias = named.getAliasNode();
      if (alias !== undefined) aliases.set(alias.getText(), named.getName());
    }
  }
  return aliases;
}

export function canonicalCalleeText(text: string, aliases: ReadonlyMap<string, string>): string {
  const [head = "", ...rest] = text.split(".");
  const imported = aliases.get(head);
  if (imported === undefined) return text;
  return (imported === "" ? rest : [imported, ...rest]).join(".");
}

// `test.each(rows)(…)` and `test.if(cond)(…)` call the result of a call.
export function declarationBaseCallee(callee: Node): Node {
  return Node.isCallExpression(callee) ? declarationBaseCallee(callee.getExpression()) : callee;
}
