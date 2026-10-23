import type { AnyDb } from "../query.ts";
import { asRawClient } from "../query.ts";
import { SYSTEM_TENANT_READ_POLICY, TENANT_ISOLATION_POLICY } from "../render-rls-ddl.ts";

export type ConnectedRoleAttributes = {
  readonly roleName: string;
  readonly superuser: boolean;
  readonly bypassRowLevelSecurity: boolean;
};

export type TenantTableRowLevelSecurity = {
  readonly tableName: string;
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly hasIsolationPolicy: boolean;
  readonly hasSystemReadPolicy: boolean;
};

export async function readConnectedRoleAttributes(
  db: AnyDb,
): Promise<ConnectedRoleAttributes | undefined> {
  const rows = await asRawClient(db).unsafe<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    roleName: row.rolname,
    superuser: row.rolsuper,
    bypassRowLevelSecurity: row.rolbypassrls,
  };
}

export async function readTenantTablesRowLevelSecurity(
  db: AnyDb,
): Promise<readonly TenantTableRowLevelSecurity[]> {
  const rows = await asRawClient(db).unsafe<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
    has_isolation: boolean;
    has_system_read: boolean;
  }>(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
       EXISTS (SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = $1) AS has_isolation,
       EXISTS (SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = $2) AS has_system_read
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND EXISTS (SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped)
     ORDER BY c.relname COLLATE "C"`,
    [TENANT_ISOLATION_POLICY, SYSTEM_TENANT_READ_POLICY],
  );
  return rows.map((row) => ({
    tableName: row.relname,
    enabled: row.relrowsecurity,
    forced: row.relforcerowsecurity,
    hasIsolationPolicy: row.has_isolation,
    hasSystemReadPolicy: row.has_system_read,
  }));
}

export async function readTablesWithRowLevelSecurityEnabled(db: AnyDb): Promise<readonly string[]> {
  const rows = await asRawClient(db).unsafe<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
     ORDER BY c.relname COLLATE "C"`,
  );
  return rows.map((row) => row.relname);
}
