import { type DbRunner, requireSystemDb, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import {
  createSystemUser,
  type FeatureRegistrar,
  HookPhases,
  parseTenantId,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";

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
      // tenant is r.systemScope(), so a missing systemDb is a wiring error, not a skip.
      // Event-store paths need the raw connection; TenantDb has no execute.
      const rawDb = requireSystemDb(ctx, "tenant-created seed hook").unsafeRaw(options.reason);
      const tenantDb = createTenantDb({
        db: rawDb,
        tenantId,
        mode: "system",
        reason: options.reason,
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
