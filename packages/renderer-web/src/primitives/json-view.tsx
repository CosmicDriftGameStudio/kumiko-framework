import type { JsonViewProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

// Recursive pre-pass (not JSX) that turns `value` into a JSON.stringify-safe
// plain structure: BigInt → string, and a real ancestor-path cycle check
// (not a global "seen" set — a value referenced twice via two different,
// non-circular paths must still render twice, not collapse to "[Circular]").
function toSafeJson(value: unknown, ancestors: readonly unknown[] = []): unknown {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.includes(value)) return "[Circular]";
  const nextAncestors = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item) => toSafeJson(item, nextAncestors));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = toSafeJson(v, nextAncestors);
  return out;
}

// A broken audit/log payload must not take the whole screen down with it —
// double try/catch so even a throwing getter on the input falls back to a
// plain string instead of propagating.
function safeStringify(value: unknown, indent: number): string {
  try {
    const json = JSON.stringify(toSafeJson(value), null, indent);
    return json ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable value]";
    }
  }
}

type TokenKind = "key" | "string" | "number" | "boolean" | "null";

const TOKEN_CLASS_NAME: Record<TokenKind, string> = {
  key: "text-syntax-key font-medium",
  string: "text-syntax-string",
  number: "text-syntax-number",
  boolean: "text-syntax-literal",
  null: "text-syntax-literal italic",
};

function classifyToken(token: string): TokenKind {
  if (token.startsWith('"')) return token.endsWith(":") ? "key" : "string";
  if (token === "true" || token === "false") return "boolean";
  if (token === "null") return "null";
  return "number";
}

// The stringify output is canonical JSON — a regex tokenizer over that
// string is a fraction of the code of a recursive value-tree renderer, and
// tokens become plain React elements (never dangerouslySetInnerHTML): audit
// payloads and job logs carry untrusted third-party data, so this must not
// become an HTML-injection path.
function tokenizeJson(json: string): ReactNode[] {
  const tokenRe =
    /("(?:\\u[a-fA-F0-9]{4}|\\.|[^\\"])*"(?:\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = tokenRe.exec(json);
  let key = 0;
  while (match !== null) {
    if (match.index > lastIndex) nodes.push(json.slice(lastIndex, match.index));
    const token = match[0];
    nodes.push(
      <span key={key++} className={TOKEN_CLASS_NAME[classifyToken(token)]}>
        {token}
      </span>,
    );
    lastIndex = tokenRe.lastIndex;
    match = tokenRe.exec(json);
  }
  if (lastIndex < json.length) nodes.push(json.slice(lastIndex));
  return nodes;
}

/** Syntax-highlighted, whitespace-preserving JSON display. Bounded height
 *  with its own vertical scroll (job logs get long) instead of growing the
 *  page; wraps rather than overflowing horizontally. Colors come from the
 *  dedicated syntax-* theme tokens (styles.css), readable in light + dark. */
export function DefaultJsonView({ value, indent = 2, testId }: JsonViewProps): ReactNode {
  const json = safeStringify(value, indent);
  return (
    <pre
      data-testid={testId}
      className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs"
    >
      {tokenizeJson(json)}
    </pre>
  );
}
