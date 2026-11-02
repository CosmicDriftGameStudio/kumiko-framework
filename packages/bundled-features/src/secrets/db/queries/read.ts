import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import type { StoredEnvelope } from "../../table.ts";

// Platform-wide secrets are system tenant rows, which another tenant's scope does not read. The
// read runs in the system tenant's own scope, so RLS passes only its rows and never a third tenant's.
export function readingSecretsOf<T>(tenantId: string, read: () => Promise<T>): Promise<T> {
  return tenantId === SYSTEM_TENANT_ID
    ? runInRowLevelSecurityScope(tenantRowLevelSecurityScope(SYSTEM_TENANT_ID), read)
    : read();
}

export async function selectTenantSecretEnvelope(
  db: DbRunner,
  tenantId: TenantId,
  key: string,
): Promise<StoredEnvelope | undefined> {
  const rows = await readingSecretsOf(tenantId, () =>
    asRawClient(db).unsafe<{ envelope: StoredEnvelope }>(
      `SELECT envelope FROM read_tenant_secrets WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
      [tenantId, key],
    ),
  );
  return rows[0]?.envelope;
}
