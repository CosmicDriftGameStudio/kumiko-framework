// EXT_USER_DATA hooks for userMfa (GDPR Art. 15/17/20). Both totpSecret and
// recoveryCodes are marked userOwned in the schema for exactly this: on
// forget, the row must actually disappear — a leftover TOTP secret or
// recovery-code hash under an anonymized user is still a live credential
// nobody can rotate. Mirrors folders-user-data/hooks.ts's executor-based
// delete (rebuild-safe: forget replays via the event, a raw DELETE would be
// resurrected by a projection rebuild).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { userMfaEntity, userMfaTable } from "./schema/user-mfa";

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

// Never includes totpSecret/recoveryCodes — secret-derived credential
// material, not portable personal data (same reasoning as api-token's
// tokenHash exclusion in user-data-rights-defaults). Just confirms
// enrollment + when, which is what a data subject actually needs to see.
export const userMfaExportHook: UserDataExportHook = async (ctx) => {
  const rows = await selectMany<{ id: string; enabledAt: unknown }>(ctx.db, userMfaTable, {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "user-mfa",
    rows: rows.map((r) => ({ enrolled: true, enabledAt: String(r.enabledAt ?? "") })),
  };
};

// Always a real hard-delete regardless of the incoming strategy — a 2FA
// secret can't be anonymized, and userOwned already means this row belongs
// to exactly one user (never shared tenant data).
export const userMfaDeleteHook: UserDataDeleteHook = async (ctx) => {
  const rows = await selectMany<{ id: string }>(ctx.db, userMfaTable, {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
  });
  if (rows.length === 0) return;
  const systemUser = createSystemUser(ctx.tenantId);
  const tdb = createTenantDb(ctx.db, ctx.tenantId, "system");
  for (const row of rows) {
    await executor.forget({ id: row.id }, systemUser, tdb);
  }
};
