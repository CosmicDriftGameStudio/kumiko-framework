import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import type { BeforeTransactionResult } from "@cosmicdrift/kumiko-types/handlers";
import { unprocessable } from "../../shared/index.ts";
import { acceptLetter } from "../accept-letter.ts";
import {
  LETTER_ENTITY,
  LETTER_FAILURE_REASON,
  LETTER_STATE,
  LetterErrors,
  LetterI18n,
} from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { closeClaimWithoutBooking } from "../letter-usage.ts";
import { ResolveUnknownSchema } from "../payloads.ts";
import {
  isForeignProvider,
  providerChangedFailure,
  resolveLetterProviderOrFailure,
} from "../provider-resolver.ts";
import { transitionLetter } from "../transitions.ts";
import type { LetterAcceptance } from "../types.ts";

type ResolvePrepared = { readonly acceptance: LetterAcceptance | null };

export const resolveUnknownHandler = defineWriteHandler({
  name: "resolve-unknown",
  schema: ResolveUnknownSchema,
  access: { roles: access.privileged },
  agent: { risk: "mid" },
  beforeTransactionWhenNested: "skip",
  description:
    "Closes a letter whose handover ended without an answer and that the provider could not be asked about: marks it failed, gives the booked cost back and frees the claim. The operator checks with the provider first whether the letter exists; the note records why it is closed. When the provider did print the letter but cannot be searched for it, the operator passes its `providerJobId`: the order is fetched by id, must carry this letter's reference, and the letter is accepted at the order's price instead.",
  // The provider call runs before the transaction, so no database connection is held while it answers.
  beforeTransaction: async (event, ctx): Promise<BeforeTransactionResult<ResolvePrepared>> => {
    const { providerJobId } = event.payload;
    if (providerJobId === undefined) return { isSuccess: true, data: { acceptance: null } };
    const resolved = await resolveLetterProviderOrFailure(ctx);
    if (!resolved.isSuccess) return resolved;
    const { name, provider } = resolved.data;
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter !== null && isForeignProvider(letter, name)) return providerChangedFailure();
    const order = await provider.findByJobId?.(providerJobId);
    if (order === undefined || order === null || order.reference !== event.payload.letterId) {
      return unprocessable(LetterErrors.providerJobMismatch, LetterI18n.providerJobMismatch);
    }
    return { isSuccess: true, data: { acceptance: order.acceptance } };
  },
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return failNotFound(LETTER_ENTITY, event.payload.letterId);
    if (letter.status !== LETTER_STATE.submissionUnknown) {
      return unprocessable(LetterErrors.notSubmissionUnknown, LetterI18n.notSubmissionUnknown, {
        status: letter.status,
      });
    }
    if (event.payload.providerJobId !== undefined) {
      const { acceptance } = event.prepared ?? { acceptance: null };
      // A nested call skipped the provider phase: nothing verified the order, so nothing is accepted.
      if (acceptance === null) {
        return unprocessable(LetterErrors.stateChanged, LetterI18n.stateChanged);
      }
      const accepted = await acceptLetter(ctx, event.user, letter, {
        letterId: letter.id,
        providerJobId: acceptance.providerJobId,
        actualNet: acceptance.actualNet,
        actualVat: acceptance.actualVat,
        ...(acceptance.recognizedAddress !== undefined && {
          recognizedAddress: acceptance.recognizedAddress,
        }),
        ...(acceptance.cancelableUntil !== undefined && {
          cancelableUntil: acceptance.cancelableUntil.toString(),
        }),
        ...(acceptance.trackingNumber !== undefined && {
          trackingNumber: acceptance.trackingNumber,
        }),
      });
      if (!accepted.isSuccess) return accepted;
      if (!accepted.data.applied) {
        return unprocessable(LetterErrors.stateChanged, LetterI18n.stateChanged);
      }
      return {
        isSuccess: true,
        data: { letterId: letter.id, status: LETTER_STATE.accepted },
      };
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
    await closeClaimWithoutBooking(ctx, letter.id, letter.quotedNet?.amount ?? 0);
    return moved;
  },
});
