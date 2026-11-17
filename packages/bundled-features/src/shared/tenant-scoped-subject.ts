import { isUuid, parseTenantId, type TenantId } from "@cosmicdrift/kumiko-framework/engine";

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
