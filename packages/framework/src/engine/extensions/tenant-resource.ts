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
import type { DbRunner } from "../../db/connection.ts";
import type { TenantId } from "../types/index.ts";

// done:false asks the runner to call the hook again next tick; processed feeds the
// destroy progress event. A tick with processed 0 counts as a failed attempt, so a
// stuck hook is abandoned instead of looping forever. pending:true marks a hook that
// waits on an external operation: those ticks are no attempts, but the stage may stay
// pending only for a bounded time after its stage-started event.
export type TenantDestroyHookResult =
  | { readonly done: true; readonly processed?: number }
  | { readonly done: false; readonly processed: number; readonly pending?: boolean };

export interface TenantResourceHookCtx {
  readonly tenantId: TenantId;
  // Epoch ms; undefined = no time bound. A hook nearing it returns { done: false, processed }
  // and the runner resumes next tick, so hooks must be idempotent on re-call.
  readonly deadlineAt?: number;
  readonly db: DbRunner;
  readonly fileProviderResolver?: FileProviderResolver;
  readonly log?: (message: string) => void;
}

export type TenantResourceDestroyHook = (
  tenantId: TenantId,
  ctx: TenantResourceHookCtx,
  // biome-ignore lint/suspicious/noConfusingVoidType: public hook type, `| undefined` would reject app hooks declared as Promise<void>
) => Promise<TenantDestroyHookResult | void>;

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
