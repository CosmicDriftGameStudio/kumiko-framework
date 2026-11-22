import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import type { CreatedFileRef } from "@cosmicdrift/kumiko-framework/files";
import { discardGeneratedFile, storeGeneratedFile } from "../../file-foundation/index.ts";
import { PDF_MIME_TYPE } from "../../shared/index.ts";
import { isAtProviderState } from "../accept-letter.ts";
import {
  LETTER_ENTITY,
  LETTER_FAILURE_REASON,
  LETTER_POLL_LIMIT_PER_RUN,
  LETTER_POLL_SAFETY_NET_LIMIT,
  LETTER_SENT_TRACKING_DAYS,
  LETTER_STATE,
  LETTER_STATE_OF_PROVIDER_STATE,
  LETTER_STATE_TIMESTAMP_FIELD,
  LETTER_SUBMITTING_STALE_MS,
  LetterInternalHandlers,
  type LetterState,
} from "../constants.ts";
import { type LetterRow, letterExecutor, letterSubmissionTable } from "../entity.ts";
import { findClaim, releaseBookedEstimate, releaseReservedCost } from "../letter-usage.ts";
import { resolveLetterProvider } from "../provider-resolver.ts";
import type { LetterProvider, LetterProviderStatus } from "../types.ts";
import {
  applyProviderStatus as apply,
  cancelOnMismatch,
  hasAddressMismatch,
} from "./address-mismatch.ts";

function warn(ctx: JobContext, message: string, letter: LetterRow, error: unknown): void {
  ctx.obs.log.warn(message, {
    letterId: letter.id,
    error: error instanceof Error ? error.message : "unknown",
  });
}

async function resolveUnknown(
  ctx: JobContext,
  provider: LetterProvider,
  letter: LetterRow,
): Promise<void> {
  // skip: this provider cannot be asked, a person decides with resolve-unknown
  if (provider.findByReference === undefined) return;
  const found = await provider.findByReference(letter.id);
  // skip: the provider does not know the letter (yet); it stays for a person
  if (found === null) return;
  if (found.kind === "accepted") {
    const result = await ctx.dispatch.write(LetterInternalHandlers.recordAcceptance, {
      letterId: letter.id,
      providerJobId: found.providerJobId,
      actualNet: found.actualNet,
      actualVat: found.actualVat,
      ...(found.recognizedAddress !== undefined && { recognizedAddress: found.recognizedAddress }),
      ...(found.cancelableUntil !== undefined && {
        cancelableUntil: found.cancelableUntil.toString(),
      }),
      ...(found.trackingNumber !== undefined && { trackingNumber: found.trackingNumber }),
    });
    if (!result.isSuccess)
      throw new Error(`record-acceptance rejected: ${JSON.stringify(result.error)}`);
    return;
  }
  const rejected = await ctx.dispatch.write(LetterInternalHandlers.recordRejection, {
    letterId: letter.id,
    failureReason: LETTER_FAILURE_REASON.rejectedByProvider,
    failureDetail: `${found.code}: ${found.message}`,
  });
  if (!rejected.isSuccess)
    throw new Error(`record-rejection rejected: ${JSON.stringify(rejected.error)}`);
  const claim = await findClaim(ctx.db, letter.id);
  if (claim !== undefined) {
    await releaseReservedCost(ctx, claim, true);
    await releaseBookedEstimate(ctx, claim, letter.quotedNet?.amount ?? 0, true);
    await ctx.db.deleteMany(letterSubmissionTable, { id: claim.id });
  }
}

async function discardProofs(ctx: JobContext, proofs: readonly CreatedFileRef[]): Promise<void> {
  for (const proof of proofs) await discardGeneratedFile(ctx, ctx.systemUser, proof);
}

async function storeProofs(
  ctx: JobContext,
  letter: LetterRow,
  status: LetterProviderStatus,
): Promise<readonly CreatedFileRef[]> {
  const alreadyStored = Array.isArray(letter.proofFileRefIds) && letter.proofFileRefIds.length > 0;
  if (alreadyStored || status.state !== "sent" || !status.proofs?.length) return [];
  const stored: CreatedFileRef[] = [];
  for (const proof of status.proofs) {
    const result = await storeGeneratedFile(ctx, ctx.systemUser, {
      fileName: proof.fileName,
      mimeType: PDF_MIME_TYPE,
      data: proof.content,
      attachTo: { entityType: LETTER_ENTITY, fieldName: "proofFileRefIds", entityId: letter.id },
    });
    if (!result.isSuccess) {
      await discardProofs(ctx, stored);
      throw new Error(`storing a proof failed: ${JSON.stringify(result.error)}`);
    }
    stored.push(result.data);
  }
  return stored;
}

function statusPayload(
  letter: LetterRow,
  status: LetterProviderStatus,
  target: LetterState,
  mismatch: boolean,
  proofFileRefIds: readonly string[],
): Record<string, unknown> {
  return {
    letterId: letter.id,
    ...(target !== letter.status && { to: target }),
    ...(status.trackingNumber !== undefined &&
      status.trackingNumber !== letter.trackingNumber && { trackingNumber: status.trackingNumber }),
    ...(status.trackingStatus !== undefined &&
      status.trackingStatus !== letter.trackingStatus && { trackingStatus: status.trackingStatus }),
    ...(status.recognizedAddress !== undefined &&
      status.recognizedAddress !== letter.recognizedAddress && {
        recognizedAddress: status.recognizedAddress,
      }),
    ...(proofFileRefIds.length > 0 && { proofFileRefIds }),
    ...(mismatch && letter.addressMismatch !== true && { addressMismatch: true }),
    ...(target === LETTER_STATE.failed && {
      failureReason: LETTER_FAILURE_REASON.failedAtProvider,
    }),
  };
}

async function pollAtProvider(
  ctx: JobContext,
  provider: LetterProvider,
  letter: LetterRow,
): Promise<void> {
  const jobId = letter.providerJobId;
  // skip: no provider order to ask about
  if (!jobId) return;
  const status = await provider.status(jobId);

  if (status.state === "not-found") {
    if (isAtProviderState(letter.status)) {
      await apply(ctx, {
        letterId: letter.id,
        to: LETTER_STATE.failed,
        failureReason: LETTER_FAILURE_REASON.notFoundAtProvider,
      });
    }
    return;
  }
  const target: LetterState = LETTER_STATE_OF_PROVIDER_STATE[status.state];
  const mismatch = hasAddressMismatch(
    letter,
    status.recognizedAddress ?? letter.recognizedAddress ?? undefined,
  );
  if (
    mismatch &&
    isAtProviderState(letter.status) &&
    (await cancelOnMismatch(ctx, provider, letter, jobId))
  ) {
    return;
  }

  const proofs = await storeProofs(ctx, letter, status);
  const payload = statusPayload(
    letter,
    status,
    target,
    mismatch,
    proofs.map((proof) => String(proof.id)),
  );
  if (Object.keys(payload).length <= 1) return;
  // The proofs are attached by the apply; when it does not happen they would stay behind as orphans.
  let applied = false;
  try {
    applied = await apply(ctx, payload);
  } finally {
    if (!applied) await discardProofs(ctx, proofs);
  }
}

type PollFilter = {
  readonly field: string;
  readonly op: "gte" | "lte";
  readonly value: string;
};
type PollGroup = {
  readonly statuses: readonly LetterState[];
  readonly where?: readonly PollFilter[];
};

const POLL_SLOT_MS = 5 * 60_000;

/** One page of a group, sorted by id. The page changes with the five-minute slot, so with n letters and a
 *  budget of b every letter is asked within ceil(n/b) runs; no column or write per poll is needed.
 *  The page size is the budget left when the group starts, so a group behind a busy one can shift its pages. */
async function lettersOf(
  ctx: JobContext,
  group: PollGroup,
  limit: number,
): Promise<readonly LetterRow[]> {
  const filters = [
    { field: "status", op: "in" as const, value: group.statuses },
    ...(group.where ?? []),
  ];
  const counted = await letterExecutor.list(
    { filters, limit: 1, totalCount: true },
    ctx.systemUser,
    ctx.db,
  );
  const pages = Math.max(1, Math.ceil((counted.total ?? 0) / limit));
  const slot = Math.floor(ctx.tz.now().epochMilliseconds / POLL_SLOT_MS);
  const found = await letterExecutor.list(
    { filters, sort: "id", sortDirection: "asc", limit, offset: (slot % pages) * limit },
    ctx.systemUser,
    ctx.db,
  );
  return found.rows;
}

/** Hands a stuck handover to the same path as a handover without an answer, so its estimate is booked. */
async function markStuckSubmission(ctx: JobContext, letter: LetterRow): Promise<void> {
  const result = await ctx.dispatch.write(LetterInternalHandlers.markSubmissionUnknown, {
    letterId: letter.id,
  });
  if (!result.isSuccess) {
    throw new Error(`mark-submission-unknown rejected: ${JSON.stringify(result.error)}`);
  }
}

/** Starts the handover of a letter that stayed in `approved` after the submit job gave up. The call can meet
 *  a submit run of the same letter that is still waiting; `startSubmission` lets only one win, and the loser
 *  gives its reservation back. */
export type RestartHandover = {
  readonly staleMs: number;
  readonly submit: (letterId: string) => Promise<unknown>;
};

async function pollGroup(
  ctx: JobContext,
  provider: LetterProvider,
  group: PollGroup,
  budget: number,
  restart?: RestartHandover,
): Promise<number> {
  if (budget <= 0) return 0;
  const letters = await lettersOf(ctx, group, budget);
  for (const letter of letters) {
    try {
      if (letter.status === LETTER_STATE.submissionUnknown) {
        await resolveUnknown(ctx, provider, letter);
      } else if (letter.status === LETTER_STATE.submitting) {
        await markStuckSubmission(ctx, letter);
      } else if (letter.status === LETTER_STATE.approved) {
        await restart?.submit(letter.id);
      } else {
        await pollAtProvider(ctx, provider, letter);
      }
    } catch (error) {
      warn(ctx, "[letter-foundation:poll] a letter could not be updated", letter, error);
    }
  }
  return letters.length;
}

/** Brings letters in flight up to date. Unknown and stuck handovers get a small budget of their own, so a
 *  provider outage that fills them cannot starve letters at the provider; the rest of the run goes to
 *  letters at the provider, then to sent ones still inside the tracking window. */
export async function pollLetters(
  ctx: JobContext,
  limitPerRun: number = LETTER_POLL_LIMIT_PER_RUN,
  restart?: RestartHandover,
): Promise<void> {
  const { provider } = await resolveLetterProvider(ctx.registry);
  const now = ctx.tz.now();
  const sentSince = now.subtract({ hours: LETTER_SENT_TRACKING_DAYS * 24 }).toString();
  const stuckBefore = now.subtract({ milliseconds: LETTER_SUBMITTING_STALE_MS }).toString();
  const approvedBefore =
    restart === undefined ? undefined : now.subtract({ milliseconds: restart.staleMs }).toString();
  const safetyNetBudget = Math.min(
    LETTER_POLL_SAFETY_NET_LIMIT,
    Math.max(1, Math.floor(limitPerRun / 4)),
  );

  let budget = limitPerRun;
  budget -= await pollGroup(
    ctx,
    provider,
    { statuses: [LETTER_STATE.submissionUnknown] },
    Math.min(safetyNetBudget, budget),
  );
  budget -= await pollGroup(
    ctx,
    provider,
    {
      statuses: [LETTER_STATE.submitting],
      where: [
        {
          field: LETTER_STATE_TIMESTAMP_FIELD[LETTER_STATE.submitting],
          op: "lte",
          value: stuckBefore,
        },
      ],
    },
    Math.min(safetyNetBudget, budget),
  );
  if (approvedBefore !== undefined) {
    budget -= await pollGroup(
      ctx,
      provider,
      {
        statuses: [LETTER_STATE.approved],
        where: [
          {
            field: LETTER_STATE_TIMESTAMP_FIELD[LETTER_STATE.approved],
            op: "lte",
            value: approvedBefore,
          },
        ],
      },
      Math.min(safetyNetBudget, budget),
      restart,
    );
  }
  budget -= await pollGroup(
    ctx,
    provider,
    { statuses: [LETTER_STATE.accepted, LETTER_STATE.onHold] },
    budget,
  );
  await pollGroup(
    ctx,
    provider,
    { statuses: [LETTER_STATE.sent], where: [{ field: "sentAt", op: "gte", value: sentSince }] },
    budget,
  );
}
