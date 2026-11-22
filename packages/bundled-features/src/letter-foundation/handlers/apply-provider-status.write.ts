import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import type * as z from "zod";
import { isAtProviderState, leaveProviderQueue, stateOf } from "../accept-letter.ts";
import { LETTER_STATE, type LetterState } from "../constants.ts";
import { type LetterRow, letterExecutor, letterSubmissionTable } from "../entity.ts";
import { ApplyProviderStatusSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";
import { APPLIED, type ApplyResult, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

type ProviderStatusFields = Omit<z.infer<typeof ApplyProviderStatusSchema>, "letterId" | "to">;
type ProviderTarget = NonNullable<z.infer<typeof ApplyProviderStatusSchema>["to"]>;
type ApplyScope = {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly letter: LetterRow;
};

function isPollable(from: LetterState | undefined): from is LetterState {
  return from !== undefined && (isAtProviderState(from) || from === LETTER_STATE.sent);
}

function changesOf(fields: ProviderStatusFields) {
  return {
    ...(fields.trackingNumber !== undefined && { trackingNumber: fields.trackingNumber }),
    ...(fields.trackingStatus !== undefined && { trackingStatus: fields.trackingStatus }),
    ...(fields.recognizedAddress !== undefined && {
      recognizedAddress: fields.recognizedAddress,
    }),
    ...(fields.proofFileRefIds !== undefined && { proofFileRefIds: fields.proofFileRefIds }),
    ...(fields.addressMismatch !== undefined && { addressMismatch: fields.addressMismatch }),
    ...(fields.failureReason !== undefined && { failureReason: fields.failureReason }),
    ...(fields.failureDetail !== undefined && { failureDetail: fields.failureDetail }),
  };
}

type Changes = ReturnType<typeof changesOf>;

async function moveTo(
  scope: ApplyScope,
  from: LetterState,
  to: ProviderTarget,
  changes: Changes,
): Promise<ApplyResult> {
  const { ctx, user, letter } = scope;
  const moved = await transitionLetter(ctx, user, { letterId: letter.id, from, to, changes });
  // A sent letter can no longer be canceled at the provider, so nothing is left to give back.
  if (moved.isSuccess && to === LETTER_STATE.sent) {
    await ctx.db.deleteMany(letterSubmissionTable, { letterId: letter.id });
  }
  return moved.isSuccess ? APPLIED : NOT_APPLIED;
}

async function updateInPlace(scope: ApplyScope, changes: Changes): Promise<ApplyResult> {
  const { ctx, user, letter } = scope;
  if (Object.keys(changes).length === 0) return NOT_APPLIED;
  const updated = await letterExecutor.update({ id: letter.id, changes }, user, ctx.db, {
    skipOptimisticLock: true,
    expect: { status: letter.status },
  });
  return updated.isSuccess ? APPLIED : NOT_APPLIED;
}

export const applyProviderStatusHandler = defineWriteHandler({
  name: "apply-provider-status",
  schema: ApplyProviderStatusSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: applies what the poll learned about a letter at the provider: the new state, tracking, proofs, the recognized address and the mismatch note. Failed and canceled letters give their counters back.",
  handler: async (event, ctx): Promise<ApplyResult> => {
    const { letterId, to, ...fields } = event.payload;
    const letter = await letterExecutor.detail({ id: letterId }, event.user, ctx.db);
    if (letter === null) return NOT_APPLIED;
    const from = stateOf(letter);
    if (!isPollable(from)) return NOT_APPLIED;
    const scope: ApplyScope = { ctx, user: event.user, letter };
    const changes = changesOf(fields);
    if (to === LETTER_STATE.failed || to === LETTER_STATE.canceled) {
      const left = await leaveProviderQueue(ctx, event.user, letter, to, changes);
      return left.isSuccess ? APPLIED : NOT_APPLIED;
    }
    if (to !== undefined && to !== letter.status) return moveTo(scope, from, to, changes);
    return updateInPlace(scope, changes);
  },
});
