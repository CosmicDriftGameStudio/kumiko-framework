// data-retention deletes the last retention-held rows of a tenant whose destruction is parked, and
// has to hand the tenant back to the destroy sweep afterwards. The status belongs to
// tenant-lifecycle, which already imports data-retention, so data-retention reaches it through this
// extension point instead of importing it back.

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { findExtensionOptions } from "./collect-extension-options.ts";

export const EXT_TENANT_DESTRUCTION_HOLD = "tenantDestructionHold" as const;

export type TenantDestructionHoldProvider = {
  isParked(args: { readonly db: DbRunner; readonly tenantId: TenantId }): Promise<boolean>;
  /** Hands a parked tenant back to the destroy sweep once nothing holds it; true only when it did. */
  releaseIfFree(args: {
    readonly db: DbRunner;
    readonly registry: Registry;
    readonly tenantId: TenantId;
    readonly now: Temporal.Instant;
  }): Promise<boolean>;
};

function isTenantDestructionHoldProvider(
  options: unknown,
): options is TenantDestructionHoldProvider {
  return (
    isPlainObject(options) &&
    typeof options["isParked"] === "function" &&
    typeof options["releaseIfFree"] === "function"
  );
}

export function findTenantDestructionHoldProvider(
  registry: Registry,
): TenantDestructionHoldProvider | undefined {
  return findExtensionOptions(
    registry,
    EXT_TENANT_DESTRUCTION_HOLD,
    isTenantDestructionHoldProvider,
  );
}

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [EXT_TENANT_DESTRUCTION_HOLD]: TenantDestructionHoldProvider;
  }
}
