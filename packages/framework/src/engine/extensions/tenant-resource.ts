// Hook signature types shared by the four EXT_*_RESOURCE-style extension
// points (storageProvider, searchAdapter, externalResource, infraResource).
// runExtensionDestroyHooks (tenant-lifecycle/stages.ts) passes tenantId as
// its own positional arg for all of them, not just storageProvider — the
// stage runner's DestructionStageCtx is a structural superset of the ctx
// below, so a hook typed against it is safely assignable wherever the
// richer ctx is passed.
//
// `db` is a raw DbRunner, not a tenant-scoped TenantDb: wiping a whole
// search index, an S3 prefix, or infra resources is inherently a
// cross-tenant, bulk operation, not a row-scoped one — there is no
// escapeHatch/unsafeRaw gate here because nothing ever wraps `db`.
import type { FileProviderResolver } from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import type { DbRunner } from "../../db/connection";
import type { TenantId } from "../types";

export interface TenantResourceHookCtx {
  readonly tenantId: TenantId;
  readonly db: DbRunner;
  readonly fileProviderResolver?: FileProviderResolver;
  readonly log?: (message: string) => void;
}

export type TenantResourceDestroyHook = (
  tenantId: TenantId,
  ctx: TenantResourceHookCtx,
) => Promise<void>;

export interface TenantResourceExtensionHooks {
  readonly destroyTenant: TenantResourceDestroyHook;
}

export function isTenantResourceExtensionHooks(o: unknown): o is TenantResourceExtensionHooks {
  return (
    typeof o === "object" &&
    o !== null &&
    "destroyTenant" in o &&
    typeof o.destroyTenant === "function"
  );
}
