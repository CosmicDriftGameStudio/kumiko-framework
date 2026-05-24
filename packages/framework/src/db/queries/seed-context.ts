import type { AnyDb } from "../query";
import { asRawClient } from "../query";

export type SeedUserRow = {
  readonly id: string;
  readonly email: string;
  readonly tenantId: string;
};

export type SeedMembershipDbRow = {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly stream_tenant_id: string;
  readonly roles: string;
};

export type SeedTenantDbRow = {
  readonly id: string;
  readonly name: string;
  readonly tenant_key: string;
};

export async function selectUserByEmail(db: AnyDb, email: string): Promise<SeedUserRow | null> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT id::text AS id, email, tenant_id::text AS tenant_id
     FROM read_users
     WHERE email = $1
     LIMIT 1`,
    [email],
  )) as readonly { id: string; email: string; tenant_id: string }[];
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, tenantId: row.tenant_id };
}

export async function selectMembershipsOfUser(
  db: AnyDb,
  userId: string,
): Promise<readonly SeedMembershipDbRow[]> {
  return (await asRawClient(db).unsafe(
    `SELECT m.user_id::text AS user_id,
            m.tenant_id::text AS tenant_id,
            e.tenant_id::text AS stream_tenant_id,
            m.roles
     FROM read_tenant_memberships m
     JOIN kumiko_events e ON e.aggregate_id = m.id AND e.version = 1
     WHERE m.user_id = $1`,
    [userId],
  )) as readonly SeedMembershipDbRow[];
}

export async function selectAllTenants(db: AnyDb): Promise<readonly SeedTenantDbRow[]> {
  return (await asRawClient(db).unsafe(
    `SELECT id::text AS id, name, tenant_key
     FROM read_tenants
     ORDER BY inserted_at`,
  )) as readonly SeedTenantDbRow[];
}
