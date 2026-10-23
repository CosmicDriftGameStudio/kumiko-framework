// First statement of a rebuild tx. The rebuild runs in system scope, which the tenant isolation
// policy admits for every row; a table whose policies differ from the framework's shape could hide
// rows from the guards and let the swap drop them, so it is refused before anything is read.

import { type AnyDb, asRawClient } from "../query.ts";
import { TENANT_ISOLATION_POLICY } from "../render-rls-ddl.ts";
import { readRowLevelSecurityShape } from "./rls-shape.ts";
import { quoteTableIdent } from "./table-ops.ts";

export async function assertRebuildableRowLevelSecurity(
  tx: AnyDb,
  tableName: string,
): Promise<void> {
  // SHARE UPDATE EXCLUSIVE conflicts with CREATE/ALTER/DROP POLICY and ENABLE/FORCE (ACCESS EXCLUSIVE) but not with readers, and with itself: a second rebuild waits instead of both holding a shared lock and deadlocking on the swap's ACCESS EXCLUSIVE.
  await asRawClient(tx).unsafe(
    `LOCK TABLE public.${quoteTableIdent(tableName)} IN SHARE UPDATE EXCLUSIVE MODE`,
  );
  const state = await readRowLevelSecurityShape(tx, tableName);
  // skip: table has no row-level security, nothing to verify
  if (state === undefined || !state.enabled) return;
  const isolation = state.policies.find((policy) => policy.name === TENANT_ISOLATION_POLICY);
  const hasRestrictive = state.policies.some((policy) => policy.kind === "RESTRICTIVE");
  const isolationIntact =
    isolation !== undefined &&
    isolation.kind === "PERMISSIVE" &&
    isolation.command === "ALL" &&
    isolation.appliesToPublic;
  // skip: framework policy intact, rebuild reads are safe
  if (isolationIntact && !hasRestrictive) return;
  const listed = state.policies
    .map((policy) => `${policy.name} (${policy.kind} ${policy.command})`)
    .join(", ");
  throw new Error(
    `rebuild: public.${tableName} has row level security that a system scope rebuild cannot rely on ` +
      `(needs a PERMISSIVE ALL ${TENANT_ISOLATION_POLICY} policy for PUBLIC and no RESTRICTIVE policy); policies: ${listed || "(none)"}`,
  );
}
