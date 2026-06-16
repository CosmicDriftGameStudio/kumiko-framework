import { toKebab } from "./qualified-name";

/**
 * Regex for a valid write-handler QN shape.
 * 3 segments (feature:write:handler) or 4+ (feature:write:entity:verb).
 */
export const WRITE_HANDLER_QN_FORMAT_RE =
  /^[a-zA-Z][a-zA-Z0-9-]*:write:[a-zA-Z][a-zA-Z0-9-]*(:[a-zA-Z][a-zA-Z0-9-]*)*$/;

// Matches `dispatcher.write("qn", ...)` and `<expr>.write("qn", ...)` —
// same surface the CI guard scans. Dynamic QNs (variables, templates) are
// intentionally skipped (known limitation, documented in #403).
const DISPATCHER_WRITE_LITERAL_RE = /\.write\s*\(\s*["']([^"']+)["']/g;

/** Extract string-literal write-handler QNs from TS/TSX source text. */
export function extractDispatcherWriteQnsFromSource(source: string): readonly string[] {
  const out = new Set<string>();
  for (const match of source.matchAll(DISPATCHER_WRITE_LITERAL_RE)) {
    const qn = match[1];
    if (qn) out.add(qn);
  }
  return [...out];
}

export type WriteHandlerQnValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Validate a single QN against optional known set (kebab-normalized). */
export function validateDispatcherWriteQn(
  qn: string,
  knownQns: ReadonlySet<string>,
): WriteHandlerQnValidation {
  if (!WRITE_HANDLER_QN_FORMAT_RE.test(qn)) {
    return {
      ok: false,
      reason: `invalid QN format: "${qn}" — expected "<feature>:write:<handler>"`,
    };
  }
  if (knownQns.size > 0 && !knownQns.has(toKebab(qn))) {
    return {
      ok: false,
      reason: `unknown write handler: "${qn}" — not registered via r.writeHandler(...)`,
    };
  }
  return { ok: true };
}
