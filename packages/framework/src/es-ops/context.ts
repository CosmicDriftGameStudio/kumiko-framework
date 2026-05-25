// SeedMigrationContext-Builder. Caller (runProdApp/CLI) übergibt einen
// schon-konfigurierten Dispatcher; der Builder produziert pro-Migration
// einen tx-scoped Context der via dispatcher.write den existierenden
// Handler-Pfad nutzt — gleiches Pattern wie ein User-UI-Click.
//
// SystemUser bypassed Access-Checks (Standard-Seed-Pattern, siehe
// config-seed.ts:40). Events haben createdBy = SYSTEM_TENANT_ID-User
// → audit-fähig.

import type { DbRunner } from "../db";
import {
  selectAllTenants,
  selectMembershipsOfUser,
  selectUserByEmail,
} from "../db/queries/seed-context";
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
  // Default-Executor für System-scope-Aggregates (config-values, system
  // text-content, etc.). Bei Tenant-scope-Aggregates muss der Caller
  // explizit `tenantIdOverride` übergeben — siehe types.ts Doku.
  const defaultSystemUser = createSystemUser(SYSTEM_TENANT_ID);

  return {
    systemWriteAs: async (handlerQualifiedName, payload, tenantIdOverride) => {
      // tenantIdOverride: baut einen System-User mit der Stream-tenantId
      // damit der Event-Store-Executor das Aggregate im richtigen Stream
      // findet. Verhindert die version_conflict-Falle (siehe Memory
      // feedback_event_store_tenant_consistency.md).
      const executor =
        tenantIdOverride !== undefined ? createSystemUser(tenantIdOverride) : defaultSystemUser;
      const result = await args.dispatcher.write(handlerQualifiedName, payload, executor);
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
      const row = await selectUserByEmail(args.dbRunner, email);
      if (!row) return null;
      return { id: row.id, email: row.email, tenantId: row.tenantId };
    },

    findMembershipsOfUser: async (userId) => {
      const rows = await selectMembershipsOfUser(args.dbRunner, userId);
      return rows.map(
        (r): SeedMembershipRow => ({
          userId: r.user_id,
          tenantId: r.tenant_id,
          streamTenantId: r.stream_tenant_id,
          roles: safeParseRolesJson(r.roles),
        }),
      );
    },

    findTenants: async () => {
      const rows = await selectAllTenants(args.dbRunner);
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
