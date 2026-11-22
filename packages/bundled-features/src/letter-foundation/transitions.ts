import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { unprocessable } from "../shared/index.ts";
import {
  isLetterTransitionAllowed,
  LETTER_EVENT_OF_STATE,
  LETTER_OUTCOME_AGGREGATE_TYPE,
  LETTER_STATE_TIMESTAMP_FIELD,
  LetterErrors,
  LetterI18n,
  type LetterState,
} from "./constants.ts";
import { letterExecutor } from "./entity.ts";
import type { LetterTransitionEvent } from "./payloads.ts";

export type TransitionTarget = keyof typeof LETTER_STATE_TIMESTAMP_FIELD;

export type TransitionContext = Pick<HandlerContext, "events" | "tz"> & {
  readonly db: TenantDb;
};

export type LetterTransition = {
  readonly letterId: string;
  readonly from: LetterState;
  readonly to: TransitionTarget;
  /** Further columns written with the state change, for example the provider job id. */
  readonly changes?: Readonly<Record<string, unknown>>;
};

/**
 * The one way a letter changes state: checks the transition table, writes the new state with its
 * timestamp (only when the letter is still in `from`, so two writers cannot both win) and appends
 * the outcome event that jobs trigger on. Call it inside the handler's transaction.
 */
export async function transitionLetter(
  ctx: TransitionContext,
  user: SessionUser,
  transition: LetterTransition,
): Promise<WriteResult<{ readonly letterId: string; readonly status: LetterState }>> {
  const { letterId, from, to, changes } = transition;
  if (!isLetterTransitionAllowed(from, to)) {
    return unprocessable(LetterErrors.transitionNotAllowed, LetterI18n.transitionNotAllowed, {
      from,
      to,
    });
  }
  const updated = await letterExecutor.update(
    {
      id: letterId,
      changes: {
        ...changes,
        status: to,
        [LETTER_STATE_TIMESTAMP_FIELD[to]]: ctx.tz.now(),
      },
    },
    user,
    ctx.db,
    { skipOptimisticLock: true, expect: { status: from } },
  );
  if (!updated.isSuccess) return updated;
  const payload: LetterTransitionEvent = { letterId, from };
  await ctx.events.unsafeAppend({
    aggregateId: generateId(),
    aggregateType: LETTER_OUTCOME_AGGREGATE_TYPE,
    type: LETTER_EVENT_OF_STATE[to],
    payload,
    expectedVersion: 0,
  });
  return { isSuccess: true, data: { letterId, status: to } };
}
