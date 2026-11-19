import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type FeatureRegistrar,
  HookPhases,
  parseTenantId,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";

export type TenantCreatedSeedArgs = {
  readonly tenantId: TenantId;
  readonly rawDb: DbRunner;
  readonly tenantDb: TenantDb;
  readonly systemUser: SessionUser;
};

// Runs in the tenant-create transaction, so a failing seed rolls the tenant back.
// The seed must write into the new tenant's own streams, hence the tenant-bound system user.
export function registerTenantCreatedSeedHook(
  r: FeatureRegistrar,
  options: {
    readonly reason: string;
    readonly seed: (args: TenantCreatedSeedArgs) => Promise<void>;
  },
): void {
  r.hook({
    type: "postSave",
    target: { allOf: "tenant" },
    phase: HookPhases.inTransaction,
    escapeHatch: { reason: options.reason, grants: ["unsafeRaw"] },
    handler: async (result, ctx) => {
      // skip: only tenant creation seeds; updates also fire postSave
      if (!result.isNew) return;
      const tenantId = parseTenantId(result.data["id"]);
      // skip: defensive guard; the tenant entity always has a uuid id.
      if (tenantId === null) return;
      // A TenantDb bound to the new tenant can only be built from the raw runner: tenant:create
      // runs in the creator's tenant and systemDb.scopedTo() refuses any other tenant.
      // Self-signup fires this from auth-email-password, which is not r.systemScope(), so there
      // is no systemDb; seedTenant has already pinned ctx.db to the new tenant in system mode.
      const rawDb = ctx.systemDb ? ctx.systemDb.unsafeRaw(options.reason) : ctx.db.unsafeRaw();
      const tenantDb = createTenantDb({
        db: rawDb,
        tenantId,
        mode: "system",
        reason:
          "tenant-created seed writes into the new tenant's own streams from the creating request",
      });
      await options.seed({
        tenantId,
        rawDb,
        tenantDb,
        systemUser: createSystemUser(tenantId, ["SystemAdmin"]),
      });
    },
  });
}
