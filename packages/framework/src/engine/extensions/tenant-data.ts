// Hook-Signatur-Types für EXT_TENANT_DATA (DSGVO tenant-scoped destroy).
//
// Mirror of engine/extensions/user-data.ts at tenant granularity.
// tenant-lifecycle orchestrates destroy via registry.getExtensionUsages(EXT_TENANT_DATA).

import type { DbRunner } from "../../db/connection";
import type { Registry, TenantId } from "../types";

export interface TenantDataHookCtx {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
}

export type TenantDataDestroyHook = (ctx: TenantDataHookCtx) => Promise<void>;

export interface TenantDataExtensionHooks {
  readonly destroy: TenantDataDestroyHook;
}
