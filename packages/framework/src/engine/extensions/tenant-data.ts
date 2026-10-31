// Hook signature types for EXT_TENANT_DATA (GDPR tenant-scoped destruction).
//
// Mirror of engine/extensions/user-data.ts at tenant granularity.
// tenant-lifecycle orchestrates destruction via registry.getExtensionUsages(EXT_TENANT_DATA).

import type { FileProviderResolver } from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import type { ExecutorManagedTenantDb } from "../../db/tenant-db.ts";
import type { Registry, TenantId } from "../types/index.ts";
import type { TenantDestroyHookResult } from "./tenant-resource.ts";

// db is tenant-filtered; unfiltered access needs
// `escapeHatch: { reason }` on the owning `r.useExtension(...)` registration.
export interface TenantDataHookCtx {
  readonly db: ExecutorManagedTenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  // Epoch ms; undefined = no time bound. A hook nearing it returns { done: false, processed }
  // and the runner resumes next tick, so hooks must be idempotent on re-call.
  readonly deadlineAt?: number;
  // Threaded through from DestructionStageCtx (tenant-lifecycle/stages.ts),
  // which resolves it unconditionally for every stage. "app-data" is the
  // only stage where a fileRef row still exists to read a storageKey off —
  // the "files" stage's prefix sweep runs after this stage already purged
  // the rows. Undefined when no file-provider is
  // wired; a hook that needs it must treat that as "nothing to clean up".
  readonly fileProviderResolver?: FileProviderResolver;
  // fileRef ids referenced by rows that survive the destroy (blockDelete rows still inside keepFor);
  // a hook that purges fileRef rows must leave them alone. Recomputed every tick.
  readonly heldFileRefIds?: ReadonlySet<string>;
  readonly log?: (message: string) => void;
}

// "app-data" is the regular stage. "tenant-row" hooks run right before the tenant is tombstoned,
// after the retention hold check, for data whose absence would change that check.
export type TenantDataDestroyPhase = "app-data" | "tenant-row";

export type TenantDataDestroyHook = (
  ctx: TenantDataHookCtx,
  // biome-ignore lint/suspicious/noConfusingVoidType: public hook type, `| undefined` would reject app hooks declared as Promise<void>
) => Promise<TenantDestroyHookResult | void>;

export interface TenantDataExtensionHooks {
  readonly destroy: TenantDataDestroyHook;
  readonly phase?: TenantDataDestroyPhase;
}

export function isTenantDataExtensionHooks(o: unknown): o is TenantDataExtensionHooks {
  return typeof o === "object" && o !== null && "destroy" in o && typeof o.destroy === "function";
}
