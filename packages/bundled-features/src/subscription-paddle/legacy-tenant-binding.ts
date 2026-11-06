import { createHmac, timingSafeEqual } from "node:crypto";

const BINDING_CONTEXT = "kumiko-paddle-tenant:v1:";

// Verify only: the release that signed these bindings is gone, the key exists to check what it left in open checkouts.
export function isValidTenantBinding(key: string, tenantId: string, binding: string): boolean {
  const expected = Buffer.from(
    createHmac("sha256", key).update(`${BINDING_CONTEXT}${tenantId}`).digest("base64url"),
  );
  const candidate = Buffer.from(binding);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
