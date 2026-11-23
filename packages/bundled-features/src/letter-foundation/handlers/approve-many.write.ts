import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import type { ConfigKeyHandle } from "@cosmicdrift/kumiko-types/config";
import { unprocessable } from "../../shared/index.ts";
import {
  LETTER_ENTITY,
  LETTER_ROLES,
  LETTER_STATE,
  LetterErrors,
  LetterI18n,
} from "../constants.ts";
import { type LetterRow, letterExecutor } from "../entity.ts";
import { monthlyLimitFailure, readLetterBudget } from "../letter-usage.ts";
import { ApproveManySchema } from "../payloads.ts";
import { isLetterPrepared } from "../row-guards.ts";
import { transitionLetter } from "../transitions.ts";

function isReadyForApproval(letter: LetterRow): boolean {
  return letter.status === LETTER_STATE.awaitingApproval && isLetterPrepared(letter);
}

export function createApproveManyHandler(limitKey: ConfigKeyHandle<"number">) {
  return defineWriteHandler<"approve-many", typeof ApproveManySchema, { approved: number }>({
    name: "approve-many",
    schema: ApproveManySchema,
    access: { roles: [LETTER_ROLES.approver] },
    agent: { effect: "outbound" },
    description:
      "Approves several prepared letters at once, all or none: every letter must wait for approval with a finished preparation, and the monthly cost limit must cover all of them together.",
    handler: async (event, ctx) => {
      const letterIds = [...new Set(event.payload.letterIds)];
      const found = await letterExecutor.list(
        { filters: [{ field: "id", op: "in", value: letterIds }], limit: letterIds.length },
        event.user,
        ctx.db,
      );
      const letters = found.rows;
      const foundIds = new Set(letters.map((letter) => letter.id));
      const missing = letterIds.find((letterId) => !foundIds.has(letterId));
      if (missing !== undefined) return failNotFound(LETTER_ENTITY, missing);
      const notReady = letters.filter((letter) => !isReadyForApproval(letter)).length;
      if (notReady > 0) {
        return unprocessable(LetterErrors.notReadyForApproval, LetterI18n.notReadyForApproval, {
          count: notReady,
        });
      }
      const priceCents = letters.reduce((sum, letter) => sum + (letter.quotedNet?.amount ?? 0), 0);
      const limitFailure = monthlyLimitFailure(await readLetterBudget(ctx, limitKey), priceCents);
      if (limitFailure !== undefined) return limitFailure;

      for (const letter of letters) {
        const approved = await transitionLetter(ctx, event.user, {
          letterId: letter.id,
          from: LETTER_STATE.awaitingApproval,
          to: LETTER_STATE.approved,
          changes: { approvedBy: event.user.id, preparationIssue: null },
        });
        if (!approved.isSuccess) return approved;
      }
      return { isSuccess: true, data: { approved: letters.length } };
    },
  });
}
