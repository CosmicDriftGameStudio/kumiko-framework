// Shared by the RLS integration tests. The test connection is a superuser and bypasses RLS,
// so enforcement is probed through a NOLOGIN role via SET LOCAL ROLE.

import type { DbConnection, DbTx } from "../connection.ts";
import { extractPgError } from "../pg-error.ts";
import { asRawClient, transaction } from "../query.ts";

export const PROBE_ROLE = "kumiko_rls_probe";
export const INSUFFICIENT_PRIVILEGE = "42501";

export type ProbeSettings = { readonly tenantId?: string; readonly scope?: string };
export type ProbeRunner = ReturnType<typeof asRawClient>;

export async function createRole(db: DbConnection, quotedRoleName: string): Promise<void> {
  await asRawClient(db).unsafe(`DO $$ BEGIN
    CREATE ROLE ${quotedRoleName} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
  END $$`);
}

export async function createProbeRole(db: DbConnection): Promise<void> {
  await createRole(db, PROBE_ROLE);
}

export async function grantProbeDml(db: DbConnection, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    await asRawClient(db).unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO ${PROBE_ROLE}`,
    );
  }
}

class ProbeRollback extends Error {}

// Runs fn as the non-bypass probe role with the given session settings and always rolls back.
export async function asProbe<T>(
  db: DbConnection,
  settings: ProbeSettings,
  fn: (raw: ProbeRunner, tx: DbTx) => Promise<T>,
): Promise<T> {
  const outcomes: { readonly value: T }[] = [];
  try {
    await transaction(db, async (tx) => {
      const raw = asRawClient(tx);
      await raw.unsafe(`SET LOCAL ROLE ${PROBE_ROLE}`);
      if (settings.tenantId !== undefined) {
        await raw.unsafe(`SELECT set_config('kumiko.tenant_id', $1, true)`, [settings.tenantId]);
      }
      if (settings.scope !== undefined) {
        await raw.unsafe(`SELECT set_config('kumiko.scope', $1, true)`, [settings.scope]);
      }
      outcomes.push({ value: await fn(raw, tx) });
      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) throw error;
  }
  const outcome = outcomes[0];
  if (outcome === undefined) throw new Error("probe produced no result");
  return outcome.value;
}

export async function pgCodeOf(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
    return undefined;
  } catch (error) {
    return extractPgError(error)?.code;
  }
}

export async function visibleTenants(raw: ProbeRunner, table: string): Promise<string[]> {
  const rows = await raw.unsafe<{ tenant_id: string }>(
    `SELECT tenant_id::text AS tenant_id FROM "${table}" ORDER BY tenant_id::text`,
  );
  return rows.map((row) => row.tenant_id);
}
