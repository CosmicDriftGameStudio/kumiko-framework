// SeedMigrationContext-Builder. Caller (runProdApp/CLI) übergibt einen
// schon-konfigurierten Dispatcher; der Builder produziert pro-Migration
// einen tx-scoped Context der via dispatcher.write den existierenden
// Handler-Pfad nutzt — gleiches Pattern wie ein User-UI-Click.
//
// SystemUser bypassed Access-Checks (Standard-Seed-Pattern, siehe
// config-seed.ts:40). Events haben createdBy = SYSTEM_TENANT_ID-User
// → audit-fähig.

import { configuredPiiSubjectKms, decryptPiiFieldValues } from "../crypto/index.js";
import type { DbRunner } from "../db/index.js";
import {
  selectAllTenants,
  selectMembershipsOfUser,
  selectTemplateResources,
  selectUserByEmail,
} from "../db/queries/seed-context.js";
import { createSystemUser, SYSTEM_TENANT_ID } from "../engine/index.js";
import type { Dispatcher } from "../pipeline/dispatcher.js";
import { parseStringArrayJson } from "../utils/parse-string-array-json.js";
import type {
  SeedMembershipRow,
  SeedMigrationContext,
  SeedTemplateResourceRow,
  SeedTenantRow,
} from "./types.js";

export type CreateSeedMigrationContextArgs = {
  readonly dispatcher: Dispatcher;
  readonly dbRunner: DbRunner;
};

/** Builder: gibt eine factory-function zurück die der Runner pro-Migration
 *  aufruft. Der dbRunner kann eine Top-Connection oder eine Tx sein —
 *  Read-Helpers nutzen ihn direkt, systemWriteAs delegiert an dispatcher.
 *
 *  Hinweis: dispatcher.write bekommt den Runner-tx NICHT durchgereicht —
 *  runBatch öffnet eine eigene Transaktion auf context.db (eigene Pool-
 *  Connection). Die Writes committen daher unabhängig: ein Runner-Failure
 *  rollt NUR den Marker-Insert + dbRunner-reads zurück, die dispatcher-Writes
 *  bleiben committed. Seeds MÜSSEN deshalb idempotent sein (verifiziert in
 *  runner.integration.test.ts „dispatcher-writes vor throw bleiben committed"). */
export function createSeedMigrationContext(
  args: CreateSeedMigrationContextArgs,
): SeedMigrationContext {
  // Default-Executor für System-scope-Aggregates (config-values, system
  // text-content, etc.). Bei Tenant-scope-Aggregates muss der Caller
  // explizit `tenantIdOverride` übergeben — siehe types.ts Doku.
  const defaultSystemUser = createSystemUser(SYSTEM_TENANT_ID);

  return {
    systemWriteAs: async (handlerQualifiedName, payload, tenantIdOverride, extraRoles) => {
      // tenantIdOverride: baut einen System-User mit der Stream-tenantId
      // damit der Event-Store-Executor das Aggregate im richtigen Stream
      // findet. Verhindert die version_conflict-Falle (siehe Memory
      // feedback_event_store_tenant_consistency.md).
      const executor =
        tenantIdOverride !== undefined || (extraRoles && extraRoles.length > 0)
          ? createSystemUser(tenantIdOverride ?? SYSTEM_TENANT_ID, extraRoles)
          : defaultSystemUser;
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
          roles: parseStringArrayJson(r.roles),
        }),
      );
    },

    findTenants: async () => {
      const rows = await selectAllTenants(args.dbRunner);
      const kms = configuredPiiSubjectKms();
      // Sequential on purpose: each decrypt borrows from the KMS adapter's small pool.
      const tenants: SeedTenantRow[] = [];
      for (const r of rows) {
        // tenant.name is ciphertext at rest under an active KMS
        const decrypted = kms
          ? await decryptPiiFieldValues({ name: r.name }, ["name"], kms, {
              requestId: "es-ops:find-tenants",
            })
          : { name: r.name };
        const name = decrypted["name"];
        tenants.push({
          id: r.id,
          name: typeof name === "string" ? name : r.name,
          tenantKey: r.tenant_key,
        });
      }
      return tenants;
    },

    findTemplateResources: async (filter) => {
      const rows = await selectTemplateResources(args.dbRunner, {
        ...filter,
        tenantId: filter?.tenantId ?? SYSTEM_TENANT_ID,
      });
      return rows.map(
        (r): SeedTemplateResourceRow => ({
          id: r.id,
          tenantId: r.tenant_id,
          slug: r.slug,
          kind: r.kind,
          locale: r.locale,
          status: r.status,
        }),
      );
    },

    db: args.dbRunner,
  };
}

// Re-export für Caller-Convenience.
export type { SeedMigrationContext } from "./types.js";
