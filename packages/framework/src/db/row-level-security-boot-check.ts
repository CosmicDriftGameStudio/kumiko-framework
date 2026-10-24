import { InternalError } from "../errors/index.ts";
import { isLiveFrameworkTable, type KnownTables } from "./known-table-names.ts";
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

function listingOf(entries: readonly { table: string; missing: readonly string[] }[]): string {
  return entries.map((entry) => `${entry.table} (${entry.missing.join(", ")})`).join("; ");
}

// "database": the boot connects to the app's own database, so a table no feature declares is a
// leftover of this app. "declared tables": `schema validate` may run against a dev database several
// apps share, where undeclared tables belong to the other apps and must not fail this one.
export type RowLevelSecurityCheckScope = "database" | "declared tables";

async function assertAllTenantTablesProtected(
  db: AnyDb,
  knownTables: KnownTables,
  scope: RowLevelSecurityCheckScope,
): Promise<void> {
  const incomplete = (await readTenantTablesRowLevelSecurity(db))
    .filter((table) => scope === "database" || knownTables.has(table.tableName))
    .map((table) => ({ table: table.tableName, missing: missingPartsOf(table) }))
    .filter((entry) => entry.missing.length > 0);
  // skip: every tenant table is protected
  if (incomplete.length === 0) return;
  const frameworkTables = incomplete.filter((entry) => isLiveFrameworkTable(entry.table));
  const known = incomplete.filter(
    (entry) => !isLiveFrameworkTable(entry.table) && knownTables.has(entry.table),
  );
  const orphaned = incomplete.filter((entry) => !knownTables.has(entry.table));
  const sections = [
    ...(frameworkTables.length > 0
      ? [
          `framework tables without it: ${listingOf(frameworkTables)}. Run \`kumiko schema apply\`: it adds the missing policies to the framework tables (\`kumiko schema generate\` reports no changes for them).`,
        ]
      : []),
    ...(known.length > 0
      ? [
          `tables of this app without it: ${listingOf(known)}. Run \`kumiko schema generate\` and apply the migration.`,
        ]
      : []),
    ...(orphaned.length > 0
      ? [
          `tables no feature declares anymore: ${listingOf(orphaned)}. No feature declares them: add a migration with DROP TABLE (enable the commented \`-- DESTRUCTIVE\` DROP that \`kumiko schema generate\` emitted; see \`kumiko schema status\`).`,
        ]
      : []),
  ];
  throw new InternalError({
    message: `rowLevelSecurity is "on" but tenant tables lack row-level security. ${sections.join(" ")}`,
  });
}

async function assertNoLiveRowLevelSecurity(
  db: AnyDb,
  knownTables: KnownTables,
  scope: RowLevelSecurityCheckScope,
): Promise<void> {
  const tables = (await readTablesWithRowLevelSecurityEnabled(db)).filter(
    (table) => scope === "database" || knownTables.has(table),
  );
  // skip: no live row-level security to disable
  if (tables.length === 0) return;
  throw new InternalError({
    message: `rowLevelSecurity is "off" but row-level security is still enabled on: ${tables.join(", ")}. Without a tenant scope every statement would see zero rows. Run \`kumiko schema generate\` with rowLevelSecurity off to produce the DISABLE ROW LEVEL SECURITY migration and apply it.`,
  });
}

// Table state only, no role check: the role is a runtime property of the boot connection, so tools
// that connect with another role (CI, `schema validate`) use this one.
export async function assertRowLevelSecurityTableState(
  db: AnyDb,
  mode: RowLevelSecurityMode,
  knownTables: KnownTables,
  scope: RowLevelSecurityCheckScope = "database",
): Promise<void> {
  if (mode === "off") {
    await assertNoLiveRowLevelSecurity(db, knownTables, scope);
    // skip: off-mode check done
    return;
  }
  await assertAllTenantTablesProtected(db, knownTables, scope);
}

export async function assertRowLevelSecurityBootState(
  db: AnyDb,
  mode: RowLevelSecurityMode,
  knownTables: KnownTables,
): Promise<void> {
  if (mode === "on") await assertEnforcingRole(db);
  await assertRowLevelSecurityTableState(db, mode, knownTables);
}
