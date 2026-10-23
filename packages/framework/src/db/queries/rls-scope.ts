import { asRawClient } from "../query.ts";
import { SCOPE_SETTING, SYSTEM_SCOPE, TENANT_ID_SETTING } from "../render-rls-ddl.ts";
import type { RowLevelSecurityScope } from "../row-level-security-scope.ts";

function scopeSettings(
  scope: RowLevelSecurityScope | undefined,
): readonly [string, string, string, string] {
  const tenantId = scope?.kind === "tenant" ? scope.tenantId : "";
  const systemScope = scope?.kind === "system" ? SYSTEM_SCOPE : "";
  return [TENANT_ID_SETTING, tenantId, SCOPE_SETTING, systemScope];
}

const SET_SCOPE_SQL = `SELECT set_config($1, $2, true), set_config($3, $4, true)`;

// Returns the lazy driver query without sending it, so a caller can pipeline it right behind BEGIN;
// the caller must start it itself and in order.
export function buildRowLevelSecurityScopeQuery(
  runner: unknown,
  scope: RowLevelSecurityScope | undefined,
): PromiseLike<unknown> {
  return asRawClient(runner).unsafe(SET_SCOPE_SQL, [...scopeSettings(scope)]);
}

// set_config(..., true) is transaction-local; undefined clears both settings to ''.
export async function applyRowLevelSecurityScope(
  runner: unknown,
  scope: RowLevelSecurityScope | undefined,
): Promise<void> {
  await asRawClient(runner).unsafe(SET_SCOPE_SQL, [...scopeSettings(scope)]);
}
