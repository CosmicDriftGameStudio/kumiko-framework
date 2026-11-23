import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import type { CreatedFileRef } from "@cosmicdrift/kumiko-framework/files";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { discardGeneratedFile, storeGeneratedFile } from "../../file-foundation/index.ts";
import { PDF_MIME_TYPE } from "../../shared/index.ts";
import { isAtProviderState } from "../accept-letter.ts";
import {
  LETTER_ENTITY,
  LETTER_FAILURE_REASON,
  LETTER_POLL_LIMIT_PER_RUN,
  LETTER_POLL_RUN_BUDGET_MS,
  LETTER_POLL_SAFETY_NET_LIMIT,
  LETTER_PREPARE_STALE_MS,
  LETTER_SENT_TRACKING_DAYS,
  LETTER_STATE,
  LETTER_STATE_OF_PROVIDER_STATE,
  LETTER_STATE_TIMESTAMP_FIELD,
  LETTER_SUBMITTING_STALE_MS,
  LetterInternalHandlers,
  type LetterState,
} from "../constants.ts";
import { type LetterRow, letterExecutor } from "../entity.ts";
import { isForeignProvider, resolveLetterProvider } from "../provider-resolver.ts";
import { isLetterPrepared } from "../row-guards.ts";
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
  readonly op: "gte" | "lte" | "eq";
  readonly value: string | null;
};
type PollGroup = {
  readonly statuses: readonly LetterState[];
  readonly where?: readonly PollFilter[];
  /** Provider requests one letter of the group costs; the group's budget buys that many fewer letters. */
  readonly requestsPerLetter?: number;
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

async function dispatchForLetter(
  ctx: JobContext,
  handler: string,
  letterId: string,
): Promise<void> {
  const result = await ctx.dispatch.write(handler, { letterId });
  if (!result.isSuccess) {
    throw new Error(`${handler} rejected: ${JSON.stringify(result.error)}`);
  }
}

/** Hands a stuck handover to the same path as a handover without an answer, so its estimate is booked. */
function markStuckSubmission(ctx: JobContext, letter: LetterRow): Promise<void> {
  return dispatchForLetter(ctx, LetterInternalHandlers.markSubmissionUnknown, letter.id);
}

/** The poll never hands a letter over itself: a restart request goes through the submit job's queue,
 *  where it cannot run beside the first handover of the same letter. */
function requestHandoverRestart(ctx: JobContext, letter: LetterRow): Promise<void> {
  return dispatchForLetter(ctx, LetterInternalHandlers.requestHandoverRestart, letter.id);
}

/** The prepare job gave up on this letter (it left no preparation issue); a new run either prepares it or stores the issue. */
async function prepareAgain(ctx: JobContext, letter: LetterRow): Promise<void> {
  if (isLetterPrepared(letter) || letter.preparationIssue) return;
  await dispatchForLetter(ctx, LetterInternalHandlers.prepare, letter.id);
}

type PollProvider = {
  readonly name: string;
  readonly provider: LetterProvider;
  readonly giveUpMs: number;
};

function isApprovedPast(ctx: JobContext, letter: LetterRow, ms: number): boolean {
  const approvedAt = letter[LETTER_STATE_TIMESTAMP_FIELD[LETTER_STATE.approved]];
  if (approvedAt === null || approvedAt === undefined) return false;
  return (
    Temporal.Instant.compare(
      Temporal.Instant.from(String(approvedAt)),
      ctx.tz.now().subtract({ milliseconds: ms }),
    ) <= 0
  );
}

/** A handover that stayed stuck past the give-up time ends the letter instead of asking again. */
async function giveUpOnStalledHandover(ctx: JobContext, letter: LetterRow): Promise<void> {
  const result = await ctx.dispatch.write(LetterInternalHandlers.recordRejection, {
    letterId: letter.id,
    failureReason: LETTER_FAILURE_REASON.handoverStalled,
  });
  if (!result.isSuccess) {
    throw new Error(`record-rejection rejected: ${JSON.stringify(result.error)}`);
  }
}

async function pollLetter(ctx: JobContext, poll: PollProvider, letter: LetterRow): Promise<void> {
  const { provider } = poll;
  if (letter.status === LETTER_STATE.awaitingApproval) return prepareAgain(ctx, letter);
  if (letter.status === LETTER_STATE.submitting) return markStuckSubmission(ctx, letter);
  if (letter.status === LETTER_STATE.approved) {
    return isApprovedPast(ctx, letter, poll.giveUpMs)
      ? giveUpOnStalledHandover(ctx, letter)
      : requestHandoverRestart(ctx, letter);
  }
  if (isForeignProvider(letter, poll.name)) {
    ctx.obs.log.warn(
      "[letter-foundation:poll] a letter belongs to another provider and is left alone",
      {
        letterId: letter.id,
      },
    );
    return;
  }
  if (letter.status === LETTER_STATE.submissionUnknown) {
    return resolveUnknown(ctx, provider, letter);
  }
  return pollAtProvider(ctx, provider, letter);
}

function isPastDeadline(deadlineMs: number): boolean {
  return Temporal.Now.instant().epochMilliseconds > deadlineMs;
}

/** Returns the provider requests it budgeted, which is what the rest of the run has left to spend. */
async function pollGroup(
  ctx: JobContext,
  poll: PollProvider,
  group: PollGroup,
  budget: number,
  deadlineMs: number,
): Promise<number> {
  if (budget <= 0 || isPastDeadline(deadlineMs)) return 0;
  const requestsPerLetter = group.requestsPerLetter ?? 1;
  const letters = await lettersOf(ctx, group, Math.max(1, Math.floor(budget / requestsPerLetter)));
  let polled = 0;
  for (const letter of letters) {
    if (isPastDeadline(deadlineMs)) break;
    polled += 1;
    try {
      await pollLetter(ctx, poll, letter);
    } catch (error) {
      warn(ctx, "[letter-foundation:poll] a letter could not be updated", letter, error);
    }
  }
  return Math.min(budget, polled * requestsPerLetter);
}

export type PollOptions = {
  readonly limitPerRun?: number;
  /** How long after approval a letter still in `approved` is asked to be handed over again. */
  readonly approvedStaleMs: number;
  /** How long after approval a letter still in `approved` is failed instead of asked again. */
  readonly giveUpMs: number;
};

/** Brings letters in flight up to date. Unknown and stuck handovers get a small budget of their own, so a
 *  provider outage that fills them cannot starve letters at the provider; the rest of the run goes to
 *  letters at the provider, then to sent ones still inside the tracking window. */
export async function pollLetters(ctx: JobContext, options: PollOptions): Promise<void> {
  const deadlineMs = Temporal.Now.instant().epochMilliseconds + LETTER_POLL_RUN_BUDGET_MS;
  const { name, provider, capabilities } = await resolveLetterProvider(ctx.registry);
  const poll: PollProvider = { name, provider, giveUpMs: options.giveUpMs };
  const now = ctx.tz.now();
  const limitPerRun = options.limitPerRun ?? LETTER_POLL_LIMIT_PER_RUN;
  const safetyNetBudget = Math.min(
    LETTER_POLL_SAFETY_NET_LIMIT,
    Math.max(1, Math.floor(limitPerRun / 4)),
  );
  const olderThan = (field: string, ms: number): PollFilter => ({
    field,
    op: "lte",
    value: now.subtract({ milliseconds: ms }).toString(),
  });
  const sentSince = now.subtract({ hours: LETTER_SENT_TRACKING_DAYS * 24 }).toString();

  const steps: readonly { readonly group: PollGroup; readonly cap: number }[] = [
    {
      group: {
        statuses: [LETTER_STATE.submissionUnknown],
        requestsPerLetter: capabilities.lookupRequestsPerLetter ?? 1,
      },
      cap: safetyNetBudget,
    },
    {
      group: {
        statuses: [LETTER_STATE.awaitingApproval],
        // Only letters the prepare job left untouched: prepared ones and ones with an issue would use up the budget.
        where: [
          olderThan("insertedAt", LETTER_PREPARE_STALE_MS),
          { field: "mergedFileRefId", op: "eq", value: null },
          { field: "preparationIssue", op: "eq", value: null },
        ],
      },
      cap: safetyNetBudget,
    },
    {
      group: {
        statuses: [LETTER_STATE.submitting],
        where: [
          olderThan(
            LETTER_STATE_TIMESTAMP_FIELD[LETTER_STATE.submitting],
            LETTER_SUBMITTING_STALE_MS,
          ),
        ],
      },
      cap: safetyNetBudget,
    },
    {
      group: {
        statuses: [LETTER_STATE.approved],
        where: [
          olderThan(LETTER_STATE_TIMESTAMP_FIELD[LETTER_STATE.approved], options.approvedStaleMs),
        ],
      },
      cap: safetyNetBudget,
    },
    { group: { statuses: [LETTER_STATE.accepted, LETTER_STATE.onHold] }, cap: limitPerRun },
    {
      group: {
        statuses: [LETTER_STATE.sent],
        where: [{ field: "sentAt", op: "gte", value: sentSince }],
      },
      cap: limitPerRun,
    },
  ];
  let budget = limitPerRun;
  for (const { group, cap } of steps) {
    budget -= await pollGroup(ctx, poll, group, Math.min(cap, budget), deadlineMs);
  }
}
