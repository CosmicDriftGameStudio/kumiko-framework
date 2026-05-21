// SeedMigrationContext-Builder. Caller (runProdApp/CLI) übergibt einen
// schon-konfigurierten Dispatcher; der Builder produziert pro-Migration
// einen tx-scoped Context der via dispatcher.write den existierenden
// Handler-Pfad nutzt — gleiches Pattern wie ein User-UI-Click.
//
// SystemUser bypassed Access-Checks (Standard-Seed-Pattern, siehe
// config-seed.ts:40). Events haben createdBy = SYSTEM_TENANT_ID-User
// → audit-fähig.

import { sql } from "drizzle-orm";
import type { DbRunner } from "../db";
import { createSystemUser, SYSTEM_TENANT_ID } from "../engine";
import type { Dispatcher } from "../pipeline/dispatcher";
import type { SeedMembershipRow, SeedMigrationContext, SeedTenantRow } from "./types";

export type CreateSeedMigrationContextArgs = {
  readonly dispatcher: Dispatcher;
  readonly dbRunner: DbRunner;
};

/** Builder: gibt eine factory-function zurück die der Runner pro-Migration
 *  aufruft. Der dbRunner kann eine Top-Connection oder eine Tx sein —
 *  Read-Helpers nutzen ihn direkt, systemWriteAs delegiert an dispatcher.
 *
 *  Hinweis: dispatcher.write hat eigene tx-Logik. Wenn der Runner um die
 *  Migration eine outer-tx legt, läuft dispatcher.write als nested via
 *  postgres-savepoint. Beim Failure rollt der outer-tx auch das
 *  dispatcher-write zurück → kein partial-Apply möglich. */
export function createSeedMigrationContext(
  args: CreateSeedMigrationContextArgs,
): SeedMigrationContext {
  const systemUser = createSystemUser(SYSTEM_TENANT_ID);

  return {
    systemWriteAs: async (handlerQualifiedName, payload) => {
      const result = await args.dispatcher.write(handlerQualifiedName, payload, systemUser);
      // Critical: WriteResult{isSuccess: false} würde sonst silent durchlaufen
      // → Marker landet trotz failed-Write → Migration falsch als "applied"
      // markiert. Hier throw damit der Runner's outer-tx rollback macht und
      // Marker NICHT geschrieben wird. Seed-Author kann via try/catch eigene
      // Fehler-Behandlung machen wenn ein soft-failure erwartet ist.
      if (!result.isSuccess) {
        const code = result.error?.code ?? "unknown";
        const message = result.error?.message ?? "(no message)";
        throw new Error(
          `[es-ops/seed-migration] systemWriteAs("${handlerQualifiedName}") failed: ${code} — ${message}`,
        );
      }
      return result;
    },

    findUserByEmail: async (email) => {
      // Direct DB-Read via read_users-Projection (gleicher Pfad wie
      // UserQueries.findForAuth aber ohne Dispatcher-Roundtrip; Seeds
      // greifen oft 1-N Lookups → direkt schneller).
      // @cast-boundary db-row — drizzle execute(sql) returns row-array
      // direkt (kein { rows }-Wrapper); column-types vom SQL-Cast oben
      const rows = (await args.dbRunner.execute(
        sql`SELECT id::text AS id, email, tenant_id::text AS tenant_id
            FROM read_users
            WHERE email = ${email}
            LIMIT 1`,
      )) as unknown as readonly { id: string; email: string; tenant_id: string }[];
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, email: row.email, tenantId: row.tenant_id };
    },

    findMembershipsOfUser: async (userId) => {
      // @cast-boundary db-row — roles ist JSON-string in der text-Spalte
      // (Memory: tenant-membership.created payload "[\"User\"]"), wird unten geparst
      const rows = (await args.dbRunner.execute(
        sql`SELECT user_id::text AS user_id, tenant_id::text AS tenant_id, roles
            FROM read_tenant_memberships
            WHERE user_id = ${userId}`,
      )) as unknown as readonly { user_id: string; tenant_id: string; roles: string }[];
      return rows.map(
        (r): SeedMembershipRow => ({
          userId: r.user_id,
          tenantId: r.tenant_id,
          roles: safeParseRolesJson(r.roles),
        }),
      );
    },

    findTenants: async () => {
      // @cast-boundary db-row
      const rows = (await args.dbRunner.execute(
        sql`SELECT id::text AS id, name, tenant_key
            FROM read_tenants
            ORDER BY inserted_at`,
      )) as unknown as readonly { id: string; name: string; tenant_key: string }[];
      return rows.map((r): SeedTenantRow => ({ id: r.id, name: r.name, tenantKey: r.tenant_key }));
    },

    db: args.dbRunner,
  };
}

function safeParseRolesJson(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    // Fallthrough — return empty rather than throwing in a seed context.
  }
  return [];
}

// Re-export für Caller-Convenience.
export type { SeedMigrationContext } from "./types";
