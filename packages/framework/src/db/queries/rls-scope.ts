import { asRawClient } from "../query.ts";
import { SCOPE_SETTING, SYSTEM_SCOPE, TENANT_ID_SETTING } from "../render-rls-ddl.ts";
import type { RowLevelSecurityScope } from "../row-level-security-scope.ts";

// set_config(..., true) is transaction-local; undefined clears both settings to ''.
export async function applyRowLevelSecurityScope(
  runner: unknown,
  scope: RowLevelSecurityScope | undefined,
): Promise<void> {
  const tenantId = scope?.kind === "tenant" ? scope.tenantId : "";
  const systemScope = scope?.kind === "system" ? SYSTEM_SCOPE : "";
  await asRawClient(runner).unsafe(`SELECT set_config($1, $2, true), set_config($3, $4, true)`, [
    TENANT_ID_SETTING,
    tenantId,
    SCOPE_SETTING,
    systemScope,
  ]);
}
