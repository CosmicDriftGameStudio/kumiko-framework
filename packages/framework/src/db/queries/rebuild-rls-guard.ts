// First statement of a rebuild tx. The rebuild runs in system scope, which the tenant isolation
// policy admits for every row; a table whose policies differ from the framework's shape could hide
// rows from the guards and let the swap drop them, so it is refused before anything is read.

import type { EntityTableMeta } from "../entity-table-meta.ts";
import { type AnyDb, asRawClient } from "../query.ts";
import {
  renderCreatePolicy,
  TENANT_ISOLATION_POLICY,
  tenantRowLevelSecurityFor,
} from "../render-rls-ddl.ts";
import { isFrameworkIsolationIntact, readRowLevelSecurityShape } from "./rls-shape.ts";
import { quoteTableIdent } from "./table-ops.ts";

type PolicyExpressions = { using: string | null; withCheck: string | null };

// Postgres deparses a policy expression only against a relation, so the framework expression is
// created on a throwaway copy of the live table's columns and deparsed the same way as the live one.
async function isolationExpressionsMatchFramework(tx: AnyDb, meta: EntityTableMeta) {
  const expected = tenantRowLevelSecurityFor(meta)?.policies.find(
    (policy) => policy.name === TENANT_ISOLATION_POLICY,
  );
  if (expected === undefined) return true;
  const raw = asRawClient(tx);
  const referenceTable = "kumiko_rls_reference";
  await raw.unsafe(
    `CREATE TEMP TABLE ${referenceTable} ON COMMIT DROP AS SELECT * FROM public.${quoteTableIdent(meta.tableName)} WITH NO DATA`,
  );
  await raw.unsafe(renderCreatePolicy(`pg_temp.${referenceTable}`, expected));
  const read = async (relation: string): Promise<PolicyExpressions | undefined> =>
    (
      await raw.unsafe<PolicyExpressions>(
        `SELECT pg_get_expr(polqual, polrelid) AS "using", pg_get_expr(polwithcheck, polrelid) AS "withCheck" FROM pg_policy WHERE polrelid = $1::regclass AND polname = $2`,
        [relation, TENANT_ISOLATION_POLICY],
      )
    )[0];
  const live = await read(`public.${quoteTableIdent(meta.tableName)}`);
  const referenceExpressions = await read(`pg_temp.${referenceTable}`);
  return (
    live !== undefined &&
    live.using === referenceExpressions?.using &&
    live.withCheck === referenceExpressions?.withCheck
  );
}

export async function assertRebuildableRowLevelSecurity(
  tx: AnyDb,
  meta: EntityTableMeta,
): Promise<void> {
  const tableName = meta.tableName;
  // SHARE UPDATE EXCLUSIVE conflicts with CREATE/ALTER/DROP POLICY and ENABLE/FORCE (ACCESS EXCLUSIVE) but not with readers, and with itself: a second rebuild waits instead of both holding a shared lock and deadlocking on the swap's ACCESS EXCLUSIVE.
  await asRawClient(tx).unsafe(
    `LOCK TABLE public.${quoteTableIdent(tableName)} IN SHARE UPDATE EXCLUSIVE MODE`,
  );
  const state = await readRowLevelSecurityShape(tx, tableName);
  // skip: table has no row-level security, nothing to verify
  if (state === undefined || !state.enabled) return;
  // skip: framework policy intact, rebuild reads are safe
  if (isFrameworkIsolationIntact(state) && (await isolationExpressionsMatchFramework(tx, meta))) {
    return;
  }
  const listed = state.policies
    .map((policy) => `${policy.name} (${policy.kind} ${policy.command})`)
    .join(", ");
  throw new Error(
    `rebuild: public.${tableName} has row level security that a system scope rebuild cannot rely on ` +
      `(needs the framework's PERMISSIVE ALL ${TENANT_ISOLATION_POLICY} policy for PUBLIC and no RESTRICTIVE policy); policies: ${listed || "(none)"}`,
  );
}
