import { type Node, SyntaxKind } from "ts-morph";

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

export function isGenericReason(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  if (GENERIC_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return true;
  }
  const stripped = lowered.replace(/[.!:;,]+$/, "").trim();
  return GENERIC_REASONS.has(stripped);
}
