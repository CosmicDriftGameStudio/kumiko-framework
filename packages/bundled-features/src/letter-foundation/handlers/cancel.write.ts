import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import type { BeforeTransactionResult } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { unprocessable } from "../../shared/index.ts";
import { isAtProviderState, leaveProviderQueue } from "../accept-letter.ts";
import {
  cancelBeforeHandoverInFeature,
  isCancelableBeforeHandover,
} from "../cancel-before-handover.ts";
import {
  LETTER_ENTITY,
  LETTER_ROLES,
  LETTER_STATE,
  LetterErrors,
  LetterI18n,
} from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { LetterIdSchema } from "../payloads.ts";
import {
  isForeignProvider,
  providerChangedFailure,
  resolveLetterProviderOrFailure,
} from "../provider-resolver.ts";
import type { LetterCancelRefusalReason } from "../types.ts";

// askedProvider tells "provider confirmed" from "provider never asked": the handover job may move the
// letter to the provider between the two phases, and a cancel that skipped the provider must not succeed.
type CancelPrepared =
  | { readonly askedProvider: false }
  | { readonly askedProvider: true; readonly refusal: LetterCancelRefusalReason | null };

const REFUSAL_FAILURE: Readonly<
  Record<LetterCancelRefusalReason, { readonly code: string; readonly i18nKey: string }>
> = {
  window_closed: {
    i18nKey: LetterI18n.cancelWindowClosed,
    code: LetterErrors.cancelWindowClosed,
  },
  already_processed: {
    i18nKey: LetterI18n.cancelAlreadyProcessed,
    code: LetterErrors.cancelAlreadyProcessed,
  },
  unknown_job: { i18nKey: LetterI18n.cancelUnknownJob, code: LetterErrors.cancelUnknownJob },
};

export const cancelHandler = defineWriteHandler({
  name: "cancel",
  schema: LetterIdSchema,
  access: { roles: [LETTER_ROLES.approver, ...access.admin] },
  agent: { risk: "mid" },
  beforeTransactionWhenNested: "skip",
  description:
    "Cancels a letter. Before the handover the provider is not called; after acceptance the provider cancels it while its cancel window is open and the counters go back. Refused with a reason when the provider cannot cancel any more.",
  // The provider call runs before the transaction, so no database connection is held while it answers.
  beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<CancelPrepared>> => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
    if (!isAtProviderState(letter.status))
      return { isSuccess: true, data: { askedProvider: false } };

    const resolved = await resolveLetterProviderOrFailure(ctx.registry);
    if (!resolved.isSuccess) return resolved;
    const { name, provider } = resolved.data;
    if (isForeignProvider(letter, name)) return providerChangedFailure();
    const until = letter.cancelableUntil;
    const windowOpen =
      until !== null && until !== undefined && Temporal.Instant.compare(ctx.tz.now(), until) <= 0;
    if (provider.cancel === undefined || !windowOpen || !letter.providerJobId) {
      return unprocessable(
        LetterErrors.cancelAfterAcceptanceUnavailable,
        LetterI18n.cancelAfterAcceptanceUnavailable,
      );
    }
    const result = await provider.cancel(letter.providerJobId);
    return {
      isSuccess: true,
      data: { askedProvider: true, refusal: result.kind === "refused" ? result.reason : null },
    };
  },
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
    if (isCancelableBeforeHandover(letter.status)) {
      const canceled = await cancelBeforeHandoverInFeature(ctx, event.user, letter.id);
      if (!canceled.isSuccess) return canceled;
      return {
        isSuccess: true,
        data: { letterId: letter.id, status: LETTER_STATE.canceled },
      };
    }
    if (isAtProviderState(letter.status)) {
      const prepared = event.prepared;
      if (prepared === undefined || !prepared.askedProvider) {
        return unprocessable(LetterErrors.stateChanged, LetterI18n.stateChanged);
      }
      if (prepared.refusal !== null) {
        const failure = REFUSAL_FAILURE[prepared.refusal];
        return unprocessable(failure.code, failure.i18nKey);
      }
      return leaveProviderQueue(ctx, event.user, letter, LETTER_STATE.canceled);
    }
    return unprocessable(LetterErrors.notCancelableHere, LetterI18n.notCancelableHere, {
      status: letter.status,
    });
  },
});
