import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { FORM_DRAFT_ACCESS, FORM_DRAFT_UNIQUE_KEY_CONSTRAINT } from "../constants";
import { formDraftExecutor } from "../executor";
import { lookupDraft } from "../lookup";
import { saveDraftPayloadSchema } from "../schemas";

/**
 * save is an upsert keyed on (tenantId, ownerId, draftKey) — same
 * lookup-then-create|update-with-race-retry idiom as
 * delivery/upsert-preference.ts, because createEventStoreExecutor has no
 * built-in upsert. Two racing saves for the same draftKey: the loser hits
 * the unique index (FORM_DRAFT_UNIQUE_KEY_CONSTRAINT), re-looks-up the
 * winner's row, and updates it instead of erroring.
 */
function isDraftKeyConflict(failure: WriteFailure): boolean {
  const error = failure.error as {
    code?: string;
    details?: { constraintName?: string };
  }; // @cast-boundary error-details
  return (
    error.code === "unique_violation" &&
    error.details?.constraintName === FORM_DRAFT_UNIQUE_KEY_CONSTRAINT
  );
}

export const saveDraftWrite = defineWriteHandler({
  name: "save",
  schema: saveDraftPayloadSchema,
  access: FORM_DRAFT_ACCESS,
  handler: async (event, ctx) => {
    const ownerId = event.user.id;
    const { draftKey, values, stepIndex } = event.payload;
    const T = getTemporal();
    const draft = { values, stepIndex, savedAt: T.Now.instant().toString() };

    // Autosave semantics, not collaborative editing: the caller's own latest
    // save always wins, so updates skip the optimistic-lock check rather
    // than round-tripping a row version through lookupDraft.
    const existing = await lookupDraft(ctx.db, event.user.tenantId, ownerId, draftKey);
    if (existing) {
      return formDraftExecutor.update({ id: existing.id, changes: { draft } }, event.user, ctx.db, {
        skipOptimisticLock: true,
      });
    }

    const result = await formDraftExecutor.create({ ownerId, draftKey, draft }, event.user, ctx.db);
    if (result.isSuccess) return result;
    if (!isDraftKeyConflict(result)) return result;

    const winner = await lookupDraft(ctx.db, event.user.tenantId, ownerId, draftKey);
    if (!winner) return result;
    return formDraftExecutor.update({ id: winner.id, changes: { draft } }, event.user, ctx.db, {
      skipOptimisticLock: true,
    });
  },
});
