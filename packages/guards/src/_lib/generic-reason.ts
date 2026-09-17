import { type Node, SyntaxKind, VariableDeclarationKind } from "ts-morph";

const GENERIC_REASONS = new Set([
  "",
  "todo",
  "tbd",
  "fixme",
  "legacy",
  "temp",
  "temporary",
  "hack",
  "wip",
  "n/a",
  "na",
  "none",
  "-",
  "?",
  "reason",
  "xxx",
]);

const GENERIC_PREFIXES = ["todo:", "fixme:", "tbd:"];

// undefined = not statically judgeable (template with substitutions, identifier, call), not "generic".
export function literalReasonText(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (node.isKind(SyntaxKind.StringLiteral)) return node.getLiteralValue();
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) return node.getLiteralValue();
  return undefined;
}

// Resolves an Identifier to a module-local `const` initializer, so a
// shared reason constant clears the same way as writing its text inline.
// No import-boundary resolution, no `let` (reassignment stays unjudged).
function resolveConstIdentifierText(node: Node): string | undefined {
  if (!node.isKind(SyntaxKind.Identifier)) return undefined;
  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  for (const decl of declarations) {
    if (!decl.isKind(SyntaxKind.VariableDeclaration)) continue;
    if (decl.getSourceFile() !== node.getSourceFile()) continue;
    if (decl.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) {
      continue;
    }
    const text = literalReasonText(decl.getInitializer());
    if (text !== undefined) return text;
  }
  return undefined;
}

// Same contract as literalReasonText, plus one hop: an Identifier that
// resolves to a module-local `const` string/template initializer resolves
// to that text. An import, a call, a template with substitutions, or a
// `let`/reassigned binding stays undefined — same "not statically judgeable"
// convention as literalReasonText.
export function resolveReasonText(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const literal = literalReasonText(node);
  if (literal !== undefined) return literal;
  return resolveConstIdentifierText(node);
}

export function isGenericReason(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  if (GENERIC_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return true;
  }
  const stripped = lowered.replace(/[.!:;,]+$/, "").trim();
  return GENERIC_REASONS.has(stripped);
}
