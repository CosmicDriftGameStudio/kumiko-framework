// Paddle.js runs with a public client token and can open checkouts with any
// `customData` from the browser, so `custom_data.tenantId` alone proves nothing.
// The binding is an HMAC only the server can produce: webhooks whose tenantId
// does not carry a valid binding are ignored.

import { createHmac, timingSafeEqual } from "node:crypto";
import { parseProviderConsentId } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";

const BINDING_CONTEXT = "kumiko-paddle-tenant:v1:";

export function signTenantBinding(key: string, tenantId: string): string {
  return createHmac("sha256", key).update(`${BINDING_CONTEXT}${tenantId}`).digest("base64url");
}

export function isValidTenantBinding(key: string, tenantId: string, binding: string): boolean {
  const expected = Buffer.from(signTenantBinding(key, tenantId));
  const candidate = Buffer.from(binding);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export type BoundTenant = { readonly tenantId: string; readonly consentId?: string };

/** Null unless `customData` names a tenant together with a binding that `key` signed. */
export function boundTenantOf(
  customData: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): BoundTenant | null {
  const tenantId = customData?.["tenantId"];
  const binding = customData?.["tenantBinding"];
  if (typeof tenantId !== "string" || tenantId.length === 0) return null;
  if (typeof binding !== "string" || !isValidTenantBinding(key, tenantId, binding)) return null;
  const consentId = parseProviderConsentId(customData?.["consentId"]);
  return { tenantId, ...(consentId !== undefined && { consentId }) };
}
