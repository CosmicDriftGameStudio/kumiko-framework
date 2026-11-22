import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { recognizedAddressMatches } from "../address-match.ts";
import { LETTER_FAILURE_REASON, LETTER_STATE, LetterInternalHandlers } from "../constants.ts";
import type { LetterRow } from "../entity.ts";
import type { LetterAddress, LetterProvider, LetterProviderStatus } from "../types.ts";

export function recipientOf(letter: LetterRow): LetterAddress {
  return {
    name: letter.recipientName,
    street: letter.recipientStreet,
    houseNumber: letter.recipientHouseNumber,
    postalCode: letter.recipientPostalCode,
    city: letter.recipientCity,
    ...(letter.recipientAddressExtra && { addressExtra: letter.recipientAddressExtra }),
  };
}

export async function applyProviderStatus(
  ctx: JobContext,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const result = await ctx.dispatch.write(LetterInternalHandlers.applyProviderStatus, payload);
  if (!result.isSuccess) {
    throw new Error(
      `letter-foundation: apply-provider-status was rejected: ${JSON.stringify(result.error)}`,
    );
  }
  return propertyOf(result.data, "applied") === true;
}

function isWithinCancelWindow(letter: LetterRow, now: Temporal.Instant): boolean {
  if (letter.cancelableUntil === null || letter.cancelableUntil === undefined) return false;
  return Temporal.Instant.compare(now, Temporal.Instant.from(String(letter.cancelableUntil))) <= 0;
}

export function hasAddressMismatch(
  letter: LetterRow,
  recognized: LetterProviderStatus["recognizedAddress"] | undefined,
): boolean {
  return recognized !== undefined && !recognizedAddressMatches(recipientOf(letter), recognized);
}

/** Cancels a letter at the provider when the provider read another address than the expected one;
 *  only inside the provider's cancel window. Returns whether the letter was canceled. */
export async function cancelOnMismatch(
  ctx: JobContext,
  provider: LetterProvider,
  letter: LetterRow,
  jobId: string,
): Promise<boolean> {
  // skip: this provider cannot cancel, or the cancel window has passed
  if (provider.cancel === undefined || !isWithinCancelWindow(letter, ctx.tz.now())) return false;
  const canceled = await provider.cancel(jobId);
  if (canceled.kind !== "canceled") return false;
  await applyProviderStatus(ctx, {
    letterId: letter.id,
    to: LETTER_STATE.canceled,
    failureReason: LETTER_FAILURE_REASON.addressMismatch,
  });
  return true;
}
