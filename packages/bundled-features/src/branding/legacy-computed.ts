import type { ConfigComputedFn } from "@cosmicdrift/kumiko-types/config";
import { readStoredTextOfFormerKey } from "../config/index.ts";

// Config-cascade rung below the stored rows of a branding key: a value stored
// under the pre-move managed-pages key. It makes config:query:values (and so the
// branding settings form) show that value without rewriting any stored row. A
// row under the new key, even one cleared to "", sits above this rung and wins.
export function computedFromLegacyKey(
  legacyKey: string,
  fallback: string,
): ConfigComputedFn<"text" | "select"> {
  return async ({ tenantId, userId, db }) =>
    (await readStoredTextOfFormerKey(db, legacyKey, tenantId, userId)) ?? fallback;
}
