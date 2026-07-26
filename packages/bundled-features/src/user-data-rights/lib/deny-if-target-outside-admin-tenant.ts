import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { isSystemAdminActor } from "./is-admin-actor";

export const TARGET_USER_NOT_IN_ADMIN_TENANT = "target_user_not_in_admin_tenant" as const;

type DbRaw = Parameters<typeof fetchOne>[0];

/** SystemAdmin skips; otherwise the target must have a membership in the actor's tenant. */
export async function denyIfTargetOutsideAdminTenant(
  db: DbRaw,
  actor: SessionUser,
  targetUserId: string,
): Promise<WriteFailure | undefined> {
  if (isSystemAdminActor(actor)) return undefined;
  const membership = await fetchOne(db, tenantMembershipsTable, {
    userId: targetUserId,
    tenantId: actor.tenantId,
  });
  if (membership) return undefined;
  return writeFailure(
    new AccessDeniedError({
      details: { reason: TARGET_USER_NOT_IN_ADMIN_TENANT },
    }),
  );
}
