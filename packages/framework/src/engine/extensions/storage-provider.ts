// Hook signature types for EXT_STORAGE_PROVIDER (tenant-destroy binary cleanup).
//
// Mirror of tenant-data.ts, but the destroyTenant hook takes (tenantId, ctx)
// rather than just (ctx) — runExtensionDestroyHooks (tenant-lifecycle/stages.ts)
// passes tenantId as its own positional arg for every EXT_*_RESOURCE-style
// extension point, not just this one. ctx here only guarantees tenantId plus
// the optional fileProviderResolver/log; the richer stage-runner ctx
// (tenant-lifecycle's DestructionStageCtx) is a structural superset, so a hook
// typed against this minimal ctx is safely assignable wherever that richer ctx
// is passed.

import type { FileProviderResolver } from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import type { TenantId } from "../types";

export interface StorageProviderHookCtx {
  readonly tenantId: TenantId;
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
