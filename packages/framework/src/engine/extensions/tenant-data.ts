// Hook-Signatur-Types für EXT_TENANT_DATA (DSGVO tenant-scoped destroy).
//
// Mirror of engine/extensions/user-data.ts at tenant granularity.
// tenant-lifecycle orchestrates destroy via registry.getExtensionUsages(EXT_TENANT_DATA).

import type { FileProviderResolver } from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import type { TenantDb } from "../../db/tenant-db";
import type { Registry, TenantId } from "../types";

// fw#2914 — db is tenant-filtered; unfiltered access needs
// `escapeHatch: { reason }` on the owning `r.useExtension(...)` registration.
export interface TenantDataHookCtx {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  // Threaded through from DestructionStageCtx (tenant-lifecycle/stages.ts),
  // which resolves it unconditionally for every stage. "app-data" is the
  // only stage where a fileRef row still exists to read a storageKey off —
  // the "files" stage's prefix sweep runs after this stage already purged
  // the rows (kumiko-framework#3035). Undefined when no file-provider is
  // wired; a hook that needs it must treat that as "nothing to clean up".
  readonly fileProviderResolver?: FileProviderResolver;
  readonly log?: (message: string) => void;
}

export type TenantDataDestroyHook = (ctx: TenantDataHookCtx) => Promise<void>;

export interface TenantDataExtensionHooks {
  readonly destroy: TenantDataDestroyHook;
}

export function isTenantDataExtensionHooks(o: unknown): o is TenantDataExtensionHooks {
  return typeof o === "object" && o !== null && "destroy" in o && typeof o.destroy === "function";
}
