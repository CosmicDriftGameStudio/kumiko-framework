// EXT_USER_DATA hooks for the form-draft feature's `form-draft` entity
// (GDPR Art. 20 export / Art. 17 erasure). Lives apart from form-draft so
// consumers without the user-data-rights pipeline don't pull a hard
// dependency. Mirrors notes-history-user-data.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { formDraftTable } from "../form-draft";

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

// Deliberate no-op: `draft` is annotated `userOwned` (entity.ts), which
// relies on crypto-shredding (mounted KMS) for erasure — destroying the
// owner's subject key makes every form-draft event AND projected row
// unreadable at once. Same tradeoff, same precondition (needs a mounted
// KMS adapter) as notes-history's `body`.
export const formDraftDeleteHook: UserDataDeleteHook = async () => {};
