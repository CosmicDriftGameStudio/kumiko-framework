// EXT_USER_DATA hooks for the form-draft feature's `form-draft` entity
// (GDPR Art. 20 export / Art. 17 erasure). Lives apart from form-draft so
// consumers without the user-data-rights pipeline don't pull a hard
// dependency.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { formDraftExecutor, formDraftTable } from "../form-draft";

export const formDraftExportHook: UserDataExportHook = async (ctx) => {
  const rows = await selectMany<Record<string, unknown>>(ctx.db, formDraftTable, {
    ownerId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "form-draft",
    rows: rows.map((r) => ({
      draftKey: r["draftKey"],
      draft: r["draft"],
      insertedAt: r["insertedAt"],
    })),
  };
};

// Real physical delete, not crypto-shredding — `draft` is jsonb (entity.ts
// explains why it can't use the string-only PII field-encryption engine).
// A drafted form is pure pre-submit scratch state with no value once the
// owner is gone, so both forget strategies (delete/anonymize) remove the
// row outright rather than anonymizing in place. Per-row via the executor
// (event -> rebuild-safe), scoped to this user only — never touches other
// owners' drafts, tenant model doesn't matter here (unlike folders' single-
// user gating: a form-draft row always has exactly one owner already).
export const formDraftDeleteHook: UserDataDeleteHook = async (ctx) => {
  const rows = await selectMany<{ id: string }>(ctx.db, formDraftTable, {
    tenantId: ctx.tenantId,
    ownerId: ctx.userId,
  });
  const systemUser = createSystemUser(ctx.tenantId);
  const tdb = createTenantDb(ctx.db, ctx.tenantId, "system");
  for (const row of rows) {
    await formDraftExecutor.delete({ id: row.id }, systemUser, tdb);
  }
};
