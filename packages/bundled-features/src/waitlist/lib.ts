import {
  createEventStoreExecutor,
  fetchOne,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type AppContext,
  access,
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { tenantMembershipsTable } from "../tenant/index.ts";
import { userTable } from "../user/index.ts";
import { waitlistEntryEntity, waitlistEntryTable } from "./entity.ts";

export const WAITLIST_CROSS_TENANT_REASON = "waitlist is platform-wide (systemScope)";

export const adminAccess = { roles: access.systemAdmin } as const;

export const waitlistExecutor = createEventStoreExecutor(waitlistEntryTable, waitlistEntryEntity, {
  entityName: "waitlistEntry",
});

export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

export function waitlistDb(ctx: Pick<AppContext, "systemDb">): TenantDb {
  if (!ctx.systemDb) {
    throw new InternalError({
      message: "waitlist requires ctx.systemDb — is r.systemScope() set on the feature?",
    });
  }
  return ctx.systemDb.acknowledgeCrossTenant(WAITLIST_CROSS_TENANT_REASON);
}

// Entries are systemStream rows, so every write targets the system tenant's stream.
export function platformActor(): SessionUser {
  return createSystemUser(SYSTEM_TENANT_ID);
}

// An admin re-invite can flip an accepted invitation back to pending, so the
// invitation status alone cannot prove the person holds no access.
export async function isTenantMember(
  db: TenantDb,
  email: string,
  tenantId: TenantId,
): Promise<boolean> {
  const user = await fetchOne<{ id: string }>(db, userTable, {
    email: normalizeEmail(email),
    isDeleted: false,
  });
  if (!user) return false;
  const membership = await fetchOne(db, tenantMembershipsTable, { userId: user.id, tenantId });
  return membership !== undefined && membership !== null;
}
