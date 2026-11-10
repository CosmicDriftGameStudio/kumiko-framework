import { isUuid, parseTenantId, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { peekTokenSubject } from "./signed-token.ts";

// An anonymous link holder arrives in the default tenant while the row lives in another tenant, so
// the tenant travels in the (signed) subject. "_" cannot appear in a UUID, and a grant subject
// must stay free of ":" and ".".
export type TenantScopedSubject = { readonly tenantId: TenantId; readonly rowId: string };

export function tenantScopedSubject(parts: {
  readonly tenantId: string;
  readonly rowId: string;
}): string {
  return `${parts.tenantId}_${parts.rowId}`;
}

export function parseTenantScopedSubject(subject: string): TenantScopedSubject | null {
  const [rawTenantId, rowId, ...rest] = subject.split("_");
  const tenantId = parseTenantId(rawTenantId);
  if (rest.length > 0 || tenantId === null || !isUuid(rowId)) return null;
  return { tenantId, rowId };
}

// Reads the unverified subject only to pick the tenant to dispatch into; the grant is still
// verified against the row's current anchor there.
export function peekTenantScopedSubject(token: string): TenantScopedSubject | null {
  const subject = peekTokenSubject(token);
  return subject === null ? null : parseTenantScopedSubject(subject);
}
