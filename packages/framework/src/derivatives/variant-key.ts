import { createHash } from "node:crypto";
import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";

// Deterministic JSON: object keys sorted (recursively), `undefined` values
// dropped, arrays keep their order. Two specs that are semantically equal
// (same keys, different insertion order; explicit `undefined` vs. omitted)
// serialize identically.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// A key built from the variant name alone would keep serving stale pixels
// forever after a spec change; hashing the spec into the key means a
// changed spec is automatically a new URL.
export function specHash(spec: VariantSpec): string {
  return createHash("sha256").update(canonicalJson(spec)).digest("hex").slice(0, 16);
}

export const VARIANT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/i;

export function variantSuffix(name: string, spec: VariantSpec): string {
  // `name` ends up in a storage key (see deriveKey) — an unvalidated value
  // like "../../other-tenant/x" would escape the tenant prefix the key is
  // built under.
  if (!VARIANT_NAME_PATTERN.test(name)) {
    throw new Error(
      `derivatives: variant name must match ${VARIANT_NAME_PATTERN.source} (letters, digits, hyphens; max 32 chars), got "${name}"`,
    );
  }
  return `${name}-${specHash(spec)}`;
}

// A full derivative-suffix segment is `<name>-<16 hex chars>` — mirrors
// VARIANT_NAME_PATTERN (name grammar) + specHash's fixed 16-char slice.
// Keep in sync with both if either changes.
const DERIVATIVE_SUFFIX_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}-[0-9a-f]{16}$/i;

// Mirrors deriveKey's own split so callers get the exact same base/ext this
// key's derivatives were built from.
function splitKey(key: string): { readonly base: string; readonly ext: string } {
  const lastSlash = key.lastIndexOf("/");
  const lastSegment = lastSlash === -1 ? key : key.slice(lastSlash + 1);
  const lastDot = lastSegment.lastIndexOf(".");
  if (lastDot === -1) return { base: key, ext: "" };
  const base = key.slice(0, key.length - lastSegment.length + lastDot);
  return { base, ext: lastSegment.slice(lastDot) };
}

// List-prefix that covers every derivative deriveKey() can produce for
// `originalKey` — pass to FileStorageProvider.list() to enumerate candidates,
// then filter with isDerivativeKeyOf before deleting any of them.
export function derivativeListPrefix(originalKey: string): string {
  return `${splitKey(originalKey).base}.`;
}

// True when `candidateKey` is a derivative deriveKey() could have produced
// for `originalKey` — anchored to originalKey's own basename AND extension.
// Without the extension anchor, a same-directory sibling original with a
// different extension (a different file, possibly another user's) would
// match on prefix alone and get swept into a forget/tenant-destroy delete.
export function isDerivativeKeyOf(originalKey: string, candidateKey: string): boolean {
  const { base, ext } = splitKey(originalKey);
  const prefix = `${base}.`;
  if (!candidateKey.startsWith(prefix) || !candidateKey.endsWith(ext)) return false;
  const middle = candidateKey.slice(prefix.length, candidateKey.length - ext.length);
  return DERIVATIVE_SUFFIX_PATTERN.test(middle);
}
