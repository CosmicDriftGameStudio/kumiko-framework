import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import type { ConfigKeyHandle } from "@cosmicdrift/kumiko-types/config";
import type { JobDeferral } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { CapExceededError, currentCalendarMonthStartIso } from "../../cap-counter/index.ts";
import { readTenantFile } from "../../file-foundation/index.ts";
import {
  LETTER_FAILURE_REASON,
  LETTER_STATE,
  type LetterFailureReason,
  LetterInternalHandlers,
} from "../constants.ts";
import { type LetterRow, letterExecutor, letterSubmissionTable } from "../entity.ts";
import {
  findClaim,
  type LetterClaim,
  releaseReservedCost,
  reserveLetterCost,
} from "../letter-usage.ts";
import { LetterTransitionEventSchema } from "../payloads.ts";
import { resolveLetterProvider } from "../provider-resolver.ts";
import { envelopeOf, isLetterShippingMode } from "../row-guards.ts";
import type { LetterProvider, LetterSubmission } from "../types.ts";
import { cancelOnMismatch, hasAddressMismatch, recipientOf } from "./address-mismatch.ts";

async function dispatchApplied(
  ctx: JobContext,
  type: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const result = await ctx.dispatch.write(type, payload);
  if (!result.isSuccess) {
    throw new Error(`letter-foundation: ${type} was rejected: ${JSON.stringify(result.error)}`);
  }
  return propertyOf(result.data, "applied") === true;
}

async function claimLetter(ctx: JobContext, letter: LetterRow): Promise<LetterClaim> {
  const id = crypto.randomUUID();
  try {
    await ctx.db.insertOne(letterSubmissionTable, {
      id,
      idempotencyKey: letter.idempotencyKey,
      letterId: letter.id,
      status: "claimed",
      claimedAt: ctx.tz.now().toString(),
    });
    return { id, letterId: letter.id, status: "claimed", reservationId: null, periodStart: null };
  } catch (error) {
    const existing = await findClaim(ctx.db, letter.id);
    if (existing === undefined) throw error;
    return existing;
  }
}

async function failBeforeHandover(
  ctx: JobContext,
  letter: LetterRow,
  claim: LetterClaim,
  failureReason: LetterFailureReason,
  failureDetail?: string,
): Promise<void> {
  await dispatchApplied(ctx, LetterInternalHandlers.recordRejection, {
    letterId: letter.id,
    failureReason,
    ...(failureDetail !== undefined && { failureDetail }),
  });
  await releaseReservedCost(ctx, claim, true);
  await ctx.db.deleteMany(letterSubmissionTable, { id: claim.id });
}

function remainingHoldMs(letter: LetterRow, holdMs: number, now: Temporal.Instant): number {
  if (letter.approvedAt === null || letter.approvedAt === undefined) return 0;
  const holdEnd = Temporal.Instant.from(String(letter.approvedAt)).add({ milliseconds: holdMs });
  return Math.max(0, Math.ceil(now.until(holdEnd).total("milliseconds")));
}

// Read before the letter leaves `approved`: a document that cannot be read must fail the letter, not leave it unknown.
async function buildSubmission(
  ctx: JobContext,
  letter: LetterRow,
): Promise<LetterSubmission | null> {
  if (!letter.mergedFileRefId || !isLetterShippingMode(letter.shippingMode)) return null;
  const pdf = await readTenantFile(ctx, ctx.systemUser.tenantId, letter.mergedFileRefId);
  if (pdf === null) return null;
  return {
    reference: letter.id,
    pdf: pdf.content,
    spec: {
      pageCount: letter.pageCount ?? 0,
      sheetCount: letter.sheetCount ?? 0,
      shippingMode: letter.shippingMode,
      envelope: envelopeOf(letter),
      color: letter.color,
      duplex: letter.duplex,
    },
    expectedRecipient: recipientOf(letter),
  };
}

async function submitToProvider(
  ctx: JobContext,
  provider: LetterProvider,
  letter: LetterRow,
  claim: LetterClaim,
  submission: LetterSubmission,
): Promise<void> {
  let result: Awaited<ReturnType<LetterProvider["submit"]>>;
  try {
    result = await provider.submit(submission);
  } catch (error) {
    // The provider may have the letter: no second send, the reservation stays until a person or the poll knows.
    ctx.obs.log.warn("[letter-foundation:submit] provider call ended without an answer", {
      letterId: letter.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    await dispatchApplied(ctx, LetterInternalHandlers.markSubmissionUnknown, {
      letterId: letter.id,
    });
    return;
  }
  if (result.kind === "rejected") {
    await failBeforeHandover(
      ctx,
      letter,
      claim,
      LETTER_FAILURE_REASON.rejectedByProvider,
      `${result.code}: ${result.message}`,
    );
    return;
  }
  const applied = await dispatchApplied(ctx, LetterInternalHandlers.recordAcceptance, {
    letterId: letter.id,
    providerJobId: result.providerJobId,
    actualNet: result.actualNet,
    actualVat: result.actualVat,
    ...(result.recognizedAddress !== undefined && { recognizedAddress: result.recognizedAddress }),
    ...(result.cancelableUntil !== undefined && {
      cancelableUntil: result.cancelableUntil.toString(),
    }),
    ...(result.trackingNumber !== undefined && { trackingNumber: result.trackingNumber }),
  });
  if (applied && result.recognizedAddress !== undefined) {
    await cancelIfAddressDiffers(
      ctx,
      provider,
      letter.id,
      result.providerJobId,
      result.recognizedAddress,
    );
  }
}

/** The poll would catch the same mismatch, but only every five minutes while the cancel window is short.
 *  The handover is done by now, so a failure here is left to the poll instead of failing the job. */
async function cancelIfAddressDiffers(
  ctx: JobContext,
  provider: LetterProvider,
  letterId: string,
  providerJobId: string,
  recognizedAddress: string,
): Promise<void> {
  try {
    const accepted = await letterExecutor.detail({ id: letterId }, ctx.systemUser, ctx.db);
    if (accepted === null || !hasAddressMismatch(accepted, recognizedAddress)) return;
    await cancelOnMismatch(ctx, provider, accepted, providerJobId);
  } catch (error) {
    ctx.obs.log.warn("[letter-foundation:submit] address check after the handover failed", {
      letterId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Reserves before the letter leaves `approved`: a failure here must not look like a handover that may have
 *  happened. A claim that already carries a reservation is reused, so a repeated run reserves nothing twice. */
async function claimWithReservation(
  ctx: JobContext,
  letter: LetterRow,
  quotedCents: number,
  limitKey: ConfigKeyHandle<"number">,
): Promise<LetterClaim | null> {
  const claim = await claimLetter(ctx, letter);
  if (claim.reservationId !== null) return claim;
  const periodStart = currentCalendarMonthStartIso(ctx.tz.now());
  try {
    const reservation = await reserveLetterCost(ctx, {
      quotedCents,
      limitCents: (await ctx.config?.(limitKey)) ?? 0,
      periodStart,
    });
    await ctx.db.updateMany(
      letterSubmissionTable,
      { reservationId: reservation.reservationId, periodStart },
      { id: claim.id },
    );
    return { ...claim, reservationId: reservation.reservationId, periodStart };
  } catch (error) {
    if (!(error instanceof CapExceededError)) throw error;
    await failBeforeHandover(ctx, letter, claim, LETTER_FAILURE_REASON.monthlyLimit);
    return null;
  }
}

/** Hands an approved letter to the provider once the hold time has passed. No provider call runs inside a database transaction. */
export function createSubmitLetterRun(limitKey: ConfigKeyHandle<"number">, holdMs: number) {
  return async (payload: unknown, ctx: JobContext): Promise<JobDeferral | undefined> => {
    const event = LetterTransitionEventSchema.safeParse(payload);
    // skip: trigger payload without a letter id
    if (!event.success) return undefined;
    const letter = await letterExecutor.detail({ id: event.data.letterId }, ctx.systemUser, ctx.db);
    // skip: the letter is gone
    if (letter === null) return undefined;

    if (letter.status === LETTER_STATE.submitting) {
      // An earlier run died after taking the letter: whether the provider got it is unknown.
      await dispatchApplied(ctx, LetterInternalHandlers.markSubmissionUnknown, {
        letterId: letter.id,
      });
      return undefined;
    }
    // skip: canceled during the hold, or already handed over by an earlier delivery of the event
    if (letter.status !== LETTER_STATE.approved) return undefined;

    const remaining = remainingHoldMs(letter, holdMs, ctx.tz.now());
    if (remaining > 0 && ctx.canDefer) return ctx.defer(remaining);

    const quotedCents = letter.quotedNet?.amount;
    // A missing price would reserve 0 and slip past the monthly limit, so it stops here loudly.
    if (quotedCents === undefined) {
      throw new Error(`letter-foundation: approved letter ${letter.id} has no quoted price`);
    }

    const { provider } = await resolveLetterProvider(ctx.registry);
    const claim = await claimWithReservation(ctx, letter, quotedCents, limitKey);
    // skip: the monthly limit refused the letter, it is failed by now
    if (claim === null) return undefined;

    const submission = await buildSubmission(ctx, letter);
    if (submission === null) {
      await failBeforeHandover(ctx, letter, claim, LETTER_FAILURE_REASON.documentUnreadable);
      return undefined;
    }

    if (
      !(await dispatchApplied(ctx, LetterInternalHandlers.startSubmission, { letterId: letter.id }))
    ) {
      // Another run of the same letter got there first and owns the claim: only a reservation it does not use is given back.
      const current = await findClaim(ctx.db, letter.id);
      if (current?.reservationId !== claim.reservationId) {
        await releaseReservedCost(ctx, claim, true);
      }
      return undefined;
    }

    await submitToProvider(ctx, provider, letter, claim, submission);
    return undefined;
  };
}
