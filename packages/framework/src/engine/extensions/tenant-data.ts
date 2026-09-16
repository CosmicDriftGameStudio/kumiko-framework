// Hook-Signatur-Types für EXT_TENANT_DATA (DSGVO tenant-scoped destroy).
//
// Mirror of engine/extensions/user-data.ts at tenant granularity.
// tenant-lifecycle orchestrates destroy via registry.getExtensionUsages(EXT_TENANT_DATA).

import type { TenantDb } from "../../db/tenant-db";
import type { Registry, TenantId } from "../types";

// fw#2914 — db is tenant-filtered; unfiltered access needs
// `escapeHatch: { reason }` on the owning `r.useExtension(...)` registration.
export interface TenantDataHookCtx {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
}

export type TenantDataDestroyHook = (ctx: TenantDataHookCtx) => Promise<void>;

export interface TenantDataExtensionHooks {
  readonly destroy: TenantDataDestroyHook;
}
