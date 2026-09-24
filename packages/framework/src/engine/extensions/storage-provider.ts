// EXT_STORAGE_PROVIDER (tenant-destroy binary cleanup) is one of the four
// EXT_*_RESOURCE-style extension points — see tenant-resource.ts for the
// shared hook-signature contract. Kept as aliases so the existing public
// exports/imports stay valid; a hook that needs a plain cross-tenant read
// (kumiko-framework#3035: does a foreign tenant's file_refs row still
// reference a key under THIS tenant's storage prefix) uses `db` directly via
// executeRawQueryRead — there is no `ctx.systemDb` here.
import type {
  TenantResourceDestroyHook,
  TenantResourceExtensionHooks,
  TenantResourceHookCtx,
} from "./tenant-resource";

export type StorageProviderHookCtx = TenantResourceHookCtx;
export type StorageProviderDestroyTenantHook = TenantResourceDestroyHook;
export type StorageProviderExtensionHooks = TenantResourceExtensionHooks;
