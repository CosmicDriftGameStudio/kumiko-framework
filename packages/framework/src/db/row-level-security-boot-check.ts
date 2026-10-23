import { InternalError } from "../errors/index.ts";
import {
  readConnectedRoleAttributes,
  readTablesWithRowLevelSecurityEnabled,
  readTenantTablesRowLevelSecurity,
  type TenantTableRowLevelSecurity,
} from "./queries/rls-boot-catalog.ts";
import type { AnyDb } from "./query.ts";
import type { RowLevelSecurityMode } from "./render-rls-ddl.ts";

function missingPartsOf(table: TenantTableRowLevelSecurity): readonly string[] {
  return [
    ...(table.enabled ? [] : ["ENABLE ROW LEVEL SECURITY"]),
    ...(table.forced ? [] : ["FORCE ROW LEVEL SECURITY"]),
    ...(table.hasIsolationPolicy ? [] : ["policy kumiko_tenant_isolation"]),
    ...(table.hasSystemReadPolicy ? [] : ["policy kumiko_system_tenant_read"]),
  ];
}

async function assertEnforcingRole(db: AnyDb): Promise<void> {
  const role = await readConnectedRoleAttributes(db);
  if (role === undefined) {
    throw new InternalError({ message: "row-level security boot check: current role not found." });
  }
  const bypassing = [
    ...(role.superuser ? ["SUPERUSER"] : []),
    ...(role.bypassRowLevelSecurity ? ["BYPASSRLS"] : []),
  ];
  // skip: every role enforces row-level security
  if (bypassing.length === 0) return;
  throw new InternalError({
    message: `rowLevelSecurity is "on" but the database role "${role.roleName}" has ${bypassing.join(" and ")}, which makes Postgres skip every policy. Connect as a role with NOSUPERUSER NOBYPASSRLS.`,
  });
}

async function assertAllTenantTablesProtected(db: AnyDb): Promise<void> {
  const incomplete = (await readTenantTablesRowLevelSecurity(db))
    .map((table) => ({ table: table.tableName, missing: missingPartsOf(table) }))
    .filter((entry) => entry.missing.length > 0);
  // skip: every tenant table is protected
  if (incomplete.length === 0) return;
  const listing = incomplete.map((entry) => `${entry.table} (${entry.missing.join(", ")})`);
  throw new InternalError({
    message: `rowLevelSecurity is "on" but tenant tables lack row-level security: ${listing.join("; ")}. Run \`kumiko schema generate\` and apply the migration.`,
  });
}

async function assertNoLiveRowLevelSecurity(db: AnyDb): Promise<void> {
  const tables = await readTablesWithRowLevelSecurityEnabled(db);
  // skip: no live row-level security to disable
  if (tables.length === 0) return;
  throw new InternalError({
    message: `rowLevelSecurity is "off" but row-level security is still enabled on: ${tables.join(", ")}. Without a tenant scope every statement would see zero rows. Run \`kumiko schema generate\` with rowLevelSecurity off to produce the DISABLE ROW LEVEL SECURITY migration and apply it.`,
  });
}

export async function assertRowLevelSecurityBootState(
  db: AnyDb,
  mode: RowLevelSecurityMode,
): Promise<void> {
  if (mode === "off") {
    await assertNoLiveRowLevelSecurity(db);
    // skip: off-mode check done
    return;
  }
  await assertEnforcingRole(db);
  await assertAllTenantTablesProtected(db);
}
