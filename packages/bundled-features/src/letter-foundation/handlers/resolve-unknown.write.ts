import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { unprocessable } from "../../shared/index.ts";
import {
  LETTER_ENTITY,
  LETTER_FAILURE_REASON,
  LETTER_STATE,
  LetterErrors,
  LetterI18n,
} from "../constants.ts";
import { letterExecutor, letterSubmissionTable } from "../entity.ts";
import { findClaim, releaseReservationAfterCommit } from "../letter-usage.ts";
import { ResolveUnknownSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";

export const resolveUnknownHandler = defineWriteHandler({
  name: "resolve-unknown",
  schema: ResolveUnknownSchema,
  access: { roles: access.privileged },
  agent: { risk: "mid" },
  description:
    "Closes a letter whose handover ended without an answer and that the provider could not be asked about: marks it failed, gives the reserved cost back and frees the claim. The operator checks with the provider first whether the letter exists; the note records why it is closed.",
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
    if (letter.status !== LETTER_STATE.submissionUnknown) {
      return unprocessable(LetterErrors.notSubmissionUnknown, LetterI18n.notSubmissionUnknown, {
        status: letter.status,
      });
    }
    const moved = await transitionLetter(ctx, event.user, {
      letterId: letter.id,
      from: LETTER_STATE.submissionUnknown,
      to: LETTER_STATE.failed,
      changes: {
        failureReason: LETTER_FAILURE_REASON.resolvedByOperator,
        resolutionNote: event.payload.note,
      },
    });
    if (!moved.isSuccess) return moved;
    const claim = await findClaim(ctx.db, letter.id);
    if (claim !== undefined) {
      releaseReservationAfterCommit(ctx, claim);
      await ctx.db.deleteMany(letterSubmissionTable, { id: claim.id });
    }
    return moved;
  },
});
