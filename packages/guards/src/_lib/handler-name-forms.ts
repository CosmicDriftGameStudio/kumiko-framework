import { type Node, SyntaxKind } from "ts-morph";

export const camelize = (s: string): string => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
export const kebabize = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// A handler name appears in tests in several shapes: the raw `name` value,
// the segment after the last colon ("user:create" → "create", referenced as
// `UserHandlers.create`), plus its camel/kebab variants ("invite-create" →
// "inviteCreate"). A test covers a handler if it contains ANY form.
export function nameForms(name: string): string[] {
  const seg = name.includes(":") ? (name.split(":").pop() ?? name) : name;
  return [...new Set([name, seg, camelize(seg), kebabize(seg)])];
}

export function literalStringOf(prop: Node | undefined): string | undefined {
  if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (init?.getKind() !== SyntaxKind.StringLiteral) return undefined;
  return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionsAsWord(text: string, form: string): boolean {
  return new RegExp(`\\b${escapeRegExp(form)}\\b`).test(text);
}
