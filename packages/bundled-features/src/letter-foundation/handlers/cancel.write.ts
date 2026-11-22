import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { unprocessable } from "../../shared/index.ts";
import {
  LETTER_ENTITY,
  LETTER_ROLES,
  LETTER_STATE,
  LetterErrors,
  LetterI18n,
} from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { LetterIdSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";

type CancelFrom = typeof LETTER_STATE.awaitingApproval | typeof LETTER_STATE.approved;

function isCancelableBeforeHandover(status: unknown): status is CancelFrom {
  return status === LETTER_STATE.awaitingApproval || status === LETTER_STATE.approved;
}

function isAtProvider(status: unknown): boolean {
  return status === LETTER_STATE.accepted || status === LETTER_STATE.onHold;
}

export const cancelHandler = defineWriteHandler({
  name: "cancel",
  schema: LetterIdSchema,
  access: { roles: [LETTER_ROLES.approver, ...access.admin] },
  agent: { risk: "mid" },
  description:
    "Cancels a letter that has not been handed to the print provider yet; the provider is not called.",
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
    if (isCancelableBeforeHandover(letter.status)) {
      return transitionLetter(ctx, event.user, {
        letterId: letter.id,
        from: letter.status,
        to: LETTER_STATE.canceled,
      });
    }
    // Cancelling at the provider (accepted, on hold) is a later step; until then it is refused.
    if (isAtProvider(letter.status)) {
      return unprocessable(
        LetterErrors.cancelAfterAcceptanceUnavailable,
        LetterI18n.cancelAfterAcceptanceUnavailable,
      );
    }
    return unprocessable(LetterErrors.notCancelableHere, LetterI18n.notCancelableHere, {
      status: letter.status,
    });
  },
});
