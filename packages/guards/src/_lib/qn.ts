/**
 * Shared helpers for qualified names (QN, e.g. "tickets:write:close").
 * Extracted from guard-action-wiring.ts + guard-write-handler-qns.ts, which
 * both had a byte-identical toKebab implementation inline.
 */

export function toKebab(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

// Regex for a valid write-handler QN.
// Allows 3 segments (feature:write:handler) or 4+ (feature:write:entity:verb, feature:write:domain:entity:verb).
// Accepts camelCase + kebab-case — normalization to kebab happens before the manifest match.
// Every segment is validated on its own (no ":" in the segment character set) — otherwise
// the last segment group would accept trailing/double colons like
// "tickets:write:close:" as valid.
export const VALID_QN_RE =
  /^[a-zA-Z][a-zA-Z0-9-]*:write:[a-zA-Z][a-zA-Z0-9-]*(:[a-zA-Z][a-zA-Z0-9-]*)*$/;
