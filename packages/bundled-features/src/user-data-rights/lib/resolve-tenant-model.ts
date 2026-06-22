// Resolves the app-level `tenantModel` config once for a forget run. The
// forget cron + manual handler both call this and pass the scalar into the
// pure pipeline (which refines it per-tenant with a sole-member check). The key
// is system-scoped, so the tenantId used for resolution is irrelevant —
// SYSTEM_TENANT_ID reads the system/appOverride value.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  type ConfigResolver,
  type Registry,
  SYSTEM_TENANT_ID,
  type TenantUserModel,
} from "@cosmicdrift/kumiko-framework/engine";
import { createConfigAccessor } from "../../config";
import { TENANT_MODEL_CONFIG_KEY } from "../constants";

export async function resolveAppTenantModel(args: {
  readonly registry: Registry;
  readonly configResolver: ConfigResolver | undefined;
  readonly db: DbConnection;
  readonly userId: string;
}): Promise<TenantUserModel> {
  // No resolver (e.g. a unit context) → safe default: never erase tenant-scoped data.
  if (!args.configResolver) return "multi-user";
  const config = createConfigAccessor(
    args.registry,
    args.configResolver,
    SYSTEM_TENANT_ID,
    args.userId,
    args.db,
  );
  const raw = await config(TENANT_MODEL_CONFIG_KEY);
  return raw === "single-user" ? "single-user" : "multi-user";
}
