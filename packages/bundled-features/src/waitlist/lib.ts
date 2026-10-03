import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemUser,
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { waitlistEntryEntity, waitlistEntryTable } from "./entity.js";

export const WAITLIST_CROSS_TENANT_REASON = "waitlist is platform-wide (systemScope)";

export const adminAccess = { roles: access.systemAdmin } as const;

export const waitlistExecutor = createEventStoreExecutor(waitlistEntryTable, waitlistEntryEntity, {
  entityName: "waitlistEntry",
});

export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

export function waitlistDb(ctx: HandlerContext): TenantDb {
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
