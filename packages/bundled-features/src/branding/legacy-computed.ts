import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { ConfigComputedFn } from "@cosmicdrift/kumiko-types/config";
import { selectConfigRowsForKeys } from "../config/db/queries/resolver.ts";
import { deserializeValue } from "../config/resolver.ts";

// Config-cascade rung below the stored rows of a branding key: a value stored
// under the pre-move managed-pages key. It makes config:query:values (and so the
// branding settings form) show that value without rewriting any stored row. A
// row under the new key, even one cleared to "", sits above this rung and wins.
export function computedFromLegacyKey(
  legacyKey: string,
  fallback: string,
): ConfigComputedFn<"text" | "select"> {
  return async ({ tenantId, userId, db }) => {
    const rows = await selectConfigRowsForKeys(db, [legacyKey], SYSTEM_TENANT_ID, tenantId, userId);
    const row =
      rows.find((r) => r.tenantId === tenantId && r.userId === null && r.value !== null) ??
      rows.find((r) => r.tenantId === SYSTEM_TENANT_ID && r.userId === null && r.value !== null);
    const value = row ? deserializeValue(row.value, "text") : undefined;
    return typeof value === "string" ? value : fallback;
  };
}
