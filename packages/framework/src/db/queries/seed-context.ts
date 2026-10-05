import type { DbRunner } from "../connection.js";
import type { AnyDb } from "../query.js";
import { unsafeReadRetrying } from "../query.js";
import { tableExists } from "../schema-inspection.js";
import { SOFT_DELETE_LIVE_ROW_PREDICATE } from "../table-builder.js";

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
  const rows = await unsafeReadRetrying<{ id: string; email: string; tenant_id: string }>(
    db,
    `SELECT id::text AS id, email, tenant_id::text AS tenant_id
     FROM read_users
     WHERE email = $1
     LIMIT 1`,
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, tenantId: row.tenant_id };
}

export async function selectMembershipsOfUser(
  db: AnyDb,
  userId: string,
): Promise<readonly SeedMembershipDbRow[]> {
  return unsafeReadRetrying<SeedMembershipDbRow>(
    db,
    `SELECT m.user_id::text AS user_id,
            m.tenant_id::text AS tenant_id,
            e.tenant_id::text AS stream_tenant_id,
            m.roles
     FROM read_tenant_memberships m
     JOIN kumiko_events e ON e.aggregate_id = m.id AND e.version = 1
     WHERE m.user_id = $1`,
    [userId],
  );
}

export async function selectAllTenants(db: AnyDb): Promise<readonly SeedTenantDbRow[]> {
  return unsafeReadRetrying<SeedTenantDbRow>(
    db,
    `SELECT id::text AS id, name, key AS tenant_key
     FROM read_tenants
     ORDER BY inserted_at`,
    [],
  );
}

export type SeedTemplateResourceDbRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly status: string;
};

export type SeedTemplateResourceDbFilter = {
  readonly tenantId: string;
  readonly slug?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly locale?: string;
};

// Column names are fixed fragments; every filter value is a bound parameter.
// template-resolver is an optional feature — without its table the answer is
// "no templates", not an error.
export async function selectTemplateResources(
  db: DbRunner,
  filter: SeedTemplateResourceDbFilter,
): Promise<readonly SeedTemplateResourceDbRow[]> {
  if (!(await tableExists(db, "read_template_resources"))) return [];
  const conditions = ["tenant_id = $1", SOFT_DELETE_LIVE_ROW_PREDICATE];
  const params: unknown[] = [filter.tenantId];
  for (const [column, value] of [
    ["slug", filter.slug],
    ["kind", filter.kind],
    ["status", filter.status],
    ["locale", filter.locale],
  ] as const) {
    if (value === undefined) continue;
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  }
  return unsafeReadRetrying<SeedTemplateResourceDbRow>(
    db,
    `SELECT id::text AS id, tenant_id::text AS tenant_id, slug, kind, locale, status
     FROM read_template_resources
     WHERE ${conditions.join(" AND ")}
     ORDER BY slug, locale`,
    params,
  );
}
