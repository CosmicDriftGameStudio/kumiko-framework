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
  return createHash("sha256").update(canonicalJson(spec)).digest("hex").slice(0, 8);
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
