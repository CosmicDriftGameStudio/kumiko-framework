// Hook signature types for EXT_STORAGE_PROVIDER (tenant-destroy binary cleanup).
//
// Mirror of tenant-data.ts, but the destroyTenant hook takes (tenantId, ctx)
// rather than just (ctx) — runExtensionDestroyHooks (tenant-lifecycle/stages.ts)
// passes tenantId as its own positional arg for every EXT_*_RESOURCE-style
// extension point, not just this one. ctx here guarantees tenantId, db, plus
// the optional fileProviderResolver/log; the richer stage-runner ctx
// (tenant-lifecycle's DestructionStageCtx) is a structural superset, so a hook
// typed against this minimal ctx is safely assignable wherever that richer ctx
// is passed.
//
// `db` is a raw DbRunner, NOT a tenant-scoped TenantDb — unlike
// TenantDataHookCtx.db (EXT_TENANT_DATA), runExtensionDestroyHooks hands every
// EXT_*_RESOURCE-style hook (this one included) the stage runner's own
// DestructionStageCtx.db straight through, with no tenant filter and no
// escapeHatch/unsafeRaw gate — there is nothing to declare, because nothing
// ever wraps it. That's deliberate for this stage family: wiping a whole
// search index, an S3 prefix, or infra resources is inherently a cross-tenant,
// bulk operation, not a row-scoped one. A hook that needs a plain read across
// tenants (kumiko-framework#3035: does a foreign tenant's file_refs row still
// reference a key under THIS tenant's storage prefix) uses `db` directly via
// executeRawQueryRead — there is no `ctx.systemDb` here (that belongs to
// HandlerContext / r.systemScope() write-handler dispatch, a different code
// path this stage runner never goes through).
import type { FileProviderResolver } from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import type { DbRunner } from "../../db/connection";
import type { TenantId } from "../types";

export interface StorageProviderHookCtx {
  readonly tenantId: TenantId;
  readonly db: DbRunner;
  readonly fileProviderResolver?: FileProviderResolver;
  readonly log?: (message: string) => void;
}

export type StorageProviderDestroyTenantHook = (
  tenantId: TenantId,
  ctx: StorageProviderHookCtx,
) => Promise<void>;

export interface StorageProviderExtensionHooks {
  readonly destroyTenant: StorageProviderDestroyTenantHook;
}
