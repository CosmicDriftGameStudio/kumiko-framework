// SeedMigrationContext builder. The caller (runProdApp/CLI) supplies a
// preconfigured dispatcher; the builder creates a transaction-scoped context
// for each migration that uses the existing handler path through
// dispatcher.write—the same pattern as a user UI click.
//
// The system user bypasses access checks (the standard seed pattern; see
// config-seed.ts:40). Events have createdBy = SYSTEM_TENANT_ID user,
// making them auditable.

import { configuredPiiSubjectKms, decryptPiiFieldValues } from "../crypto/index.ts";
import type { DbRunner } from "../db/index.ts";
import {
  selectAllTenants,
  selectMembershipsOfUser,
  selectTemplateResources,
  selectUserByEmail,
} from "../db/queries/seed-context.ts";
import { createSystemUser, SYSTEM_TENANT_ID } from "../engine/index.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { parseStringArrayJson } from "../utils/parse-string-array-json.ts";
import type {
  SeedMembershipRow,
  SeedMigrationContext,
  SeedTemplateResourceRow,
  SeedTenantRow,
} from "./types.ts";

export type CreateSeedMigrationContextArgs = {
  readonly dispatcher: Dispatcher;
  readonly dbRunner: DbRunner;
};

/** Builder that returns a factory function called by the runner for each
 *  migration. dbRunner may be a top-level connection or a transaction—read
 *  helpers use it directly, while systemWriteAs delegates to the dispatcher.
 *
 *  dispatcher.write does not receive the runner transaction: runBatch opens
 *  a separate transaction on context.db (using a separate pool connection).
 *  Writes therefore commit independently: a runner failure rolls back only
 *  the marker insert and dbRunner reads; dispatcher writes remain committed.
 *  Seeds must therefore be idempotent (verified in
 *  runner.integration.test.ts “dispatcher-writes vor throw bleiben committed”). */
export function createSeedMigrationContext(
  args: CreateSeedMigrationContextArgs,
): SeedMigrationContext {
  // Default executor for system-scope aggregates (config-values, system
  // text-content, etc.). For tenant-scope aggregates, the caller must
  // explicitly provide `tenantIdOverride`—see the documentation in types.ts.
  const defaultSystemUser = createSystemUser(SYSTEM_TENANT_ID);

  return {
    systemWriteAs: async (handlerQualifiedName, payload, tenantIdOverride, extraRoles) => {
      // tenantIdOverride creates a system user with the stream tenant ID so that
      // the event-store executor finds the aggregate in the correct stream.
      // This prevents the version_conflict failure.
      const executor =
        tenantIdOverride !== undefined || (extraRoles && extraRoles.length > 0)
          ? createSystemUser(tenantIdOverride ?? SYSTEM_TENANT_ID, extraRoles)
          : defaultSystemUser;
      const result = await args.dispatcher.write(handlerQualifiedName, payload, executor);
      // Without this check, WriteResult{isSuccess: false} would pass silently,
      // causing the marker to be written despite the failed write and the
      // migration to be incorrectly marked as "applied". Throw so the
      // runner's outer transaction rolls back and the marker is not written.
      // Seed authors can use try/catch for custom handling when a soft failure
      // is expected.
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

// Re-export for caller convenience.
export type { SeedMigrationContext } from "./types.ts";
