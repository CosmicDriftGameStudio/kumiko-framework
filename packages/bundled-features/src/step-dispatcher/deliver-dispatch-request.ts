import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_FAILED_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
  STEP_DISPATCHED_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { MultiStreamApplyContext } from "@cosmicdrift/kumiko-framework/pipeline";
import { SYSTEM_USER_ID, type TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { redactEmailAddresses } from "../shared/index.ts";
import {
  buildDispatchSpec,
  dispatchRequestedPayloadSchema,
  rawStepKindOf,
  readPayloadFields,
} from "./dispatch-payload.ts";
import { type MailDispatchResult, performMailDispatch } from "./mail-runner.ts";
import { performWebhookDispatch } from "./webhook-runner.ts";

const log = createFallbackLogger("step-dispatcher");

// zod issue messages can echo the invalid value (e.g. a rejected url) back
// into the tenant-visible dispatch-failed event — keep this generic.
const INVALID_DISPATCH_PAYLOAD_ERROR = "invalid dispatch payload";
const PAYLOAD_UNREADABLE_ERROR = "dispatch payload is not readable";
// Adapter errors (e.g. SMTP 550) usually echo the recipient address; the
// dispatch-failed text outlives the payload erase, so only this is persisted.
const MAIL_DELIVERY_FAILED_ERROR = "mail delivery failed";
const PAYLOAD_ERASED_ERROR = "dispatch payload erased before an outcome was recorded";
// Thrown messages land in BullMQ's failedReason and the run log, so this never
// carries the receiver's error text or the target url.
const DELIVERY_RETRY_ERROR = "step delivery failed, retrying";
const DISPATCH_THREW_ERROR = "delivery attempt threw unexpectedly";
const FINAL_ATTEMPT_ABORTED_ERROR = "delivery aborted on the final attempt";
const FINAL_ATTEMPT_UNRECORDED_ERROR = "step delivery failed and its outcome could not be recorded";

export function isDispatchOutcome(e: { readonly type: string }): boolean {
  return e.type === STEP_DISPATCHED_TYPE || e.type === STEP_DISPATCH_FAILED_TYPE;
}

export async function eraseDispatchKey(aggregateId: string): Promise<void> {
  await configuredPiiSubjectKms()?.eraseKey(
    { kind: "record", entity: STEP_DISPATCH_AGGREGATE_TYPE, id: aggregateId },
    {
      requestId: requestContext.get()?.requestId ?? "step-dispatcher",
      eraseReason: "step-dispatch-outcome-recorded",
    },
  );
}

type DeliveryResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

// Mail adapter failures carry no status to classify, so every one is retried.
function mailResultAsDelivery(result: MailDispatchResult): DeliveryResult {
  return result.ok ? result : { ...result, retryable: true };
}

export type DeliverDispatchRequestArgs = {
  readonly aggregateId: string;
  readonly tenantId: TenantId;
  // 1-based run number of the job; finalAttempt = no retry follows a throw.
  readonly attempt: number;
  readonly finalAttempt: boolean;
  // The outcome events are stamped with the requesting user, which is only
  // known after the stream was loaded — hence a factory instead of a ready ctx.
  readonly applyContextFor: (userId: string) => MultiStreamApplyContext;
};

// Outcome events are plaintext and generic; the request payload's per-dispatch
// key is erased right after, so the PII dies with the dispatch instead of
// living in the event log. The outcome is appended before the erase on
// purpose: if the erase throws, the outcome survives and a redelivery only
// repeats the erase. A crash between the send and the outcome append still
// re-sends under the same Idempotency-Key — the one remaining double-send case.
// A transient failure before the final attempt throws without an outcome or
// erase: the key must survive until the outcome is final.
export async function deliverDispatchRequest(args: DeliverDispatchRequestArgs): Promise<void> {
  const { aggregateId, finalAttempt } = args;
  const stream = await args.applyContextFor(SYSTEM_USER_ID).loadAggregate(aggregateId);
  if (stream.some(isDispatchOutcome)) {
    await eraseDispatchKey(aggregateId);
    // skip: redelivery after an outcome was recorded — only the erase is repeated
    return;
  }

  const requested = stream.find((e) => e.type === STEP_DISPATCH_REQUESTED_TYPE);
  if (!requested) {
    // The key ref carries no tenant, so a job triggered with a foreign or
    // unknown aggregateId must not erase anything or append to that stream.
    log.warn("step dispatch request not found, nothing delivered", { aggregateId });
    return;
  }
  const ctx = args.applyContextFor(requested.metadata.userId || SYSTEM_USER_ID);
  const recorder = createOutcomeRecorder(ctx, aggregateId, args.attempt);

  try {
    await deliverRequested(args, requested, ctx, recorder);
  } catch (err) {
    if (!finalAttempt) throw err;
    await abortOnFinalAttempt(err, ctx, recorder, aggregateId, requested.payload);
  }
}

type OutcomeRecorder = {
  readonly record: (
    type: typeof STEP_DISPATCHED_TYPE | typeof STEP_DISPATCH_FAILED_TYPE,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  readonly recordFailure: (stepKind: string, error: string) => Promise<void>;
};

function createOutcomeRecorder(
  ctx: MultiStreamApplyContext,
  aggregateId: string,
  attempt: number,
): OutcomeRecorder {
  const record: OutcomeRecorder["record"] = async (type, payload) => {
    await ctx.unsafeAppendEvent({
      aggregateId,
      aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
      type,
      payload,
    });
    await eraseDispatchKey(aggregateId);
  };
  return {
    record,
    recordFailure: (stepKind, error) =>
      record(STEP_DISPATCH_FAILED_TYPE, { stepKind, error, attempt }),
  };
}

type RequestedEvent = Awaited<ReturnType<MultiStreamApplyContext["loadAggregate"]>>[number];

async function deliverRequested(
  args: DeliverDispatchRequestArgs,
  requested: RequestedEvent,
  ctx: MultiStreamApplyContext,
  recorder: OutcomeRecorder,
): Promise<void> {
  const { aggregateId, tenantId, attempt, finalAttempt } = args;
  const { record, recordFailure } = recorder;

  const parsed = dispatchRequestedPayloadSchema.safeParse(requested.payload);
  if (!parsed.success) {
    return recordFailure(rawStepKindOf(requested.payload), INVALID_DISPATCH_PAYLOAD_ERROR);
  }
  const payload = parsed.data;

  const read = await readPayloadFields(payload);
  if (read.kind === "unreadable") return recordFailure(payload.stepKind, PAYLOAD_UNREADABLE_ERROR);
  if (read.kind === "erased") return recordFailure(payload.stepKind, PAYLOAD_ERASED_ERROR);

  const dispatchSpec = buildDispatchSpec(payload, read.fields);
  if (!dispatchSpec) return recordFailure(payload.stepKind, INVALID_DISPATCH_PAYLOAD_ERROR);

  const result = await sendDispatch(dispatchSpec, {
    aggregateId,
    tenantId,
    userId: requested.metadata.userId || SYSTEM_USER_ID,
    secrets: ctx.secrets,
  });
  if (result.ok) {
    return record(STEP_DISPATCHED_TYPE, { stepKind: payload.stepKind, status: result.status });
  }

  const loggedReason =
    payload.stepKind === "mail.send" ? redactEmailAddresses(result.error) : result.error;
  if (result.retryable && !finalAttempt) {
    log.warn("step delivery failed, will retry", { aggregateId, attempt, reason: loggedReason });
    throw new Error(DELIVERY_RETRY_ERROR);
  }
  if (payload.stepKind === "mail.send") {
    log.warn("mail dispatch failed", { aggregateId, reason: loggedReason });
    return recordFailure(payload.stepKind, MAIL_DELIVERY_FAILED_ERROR);
  }
  return recordFailure(payload.stepKind, result.error);
}

async function sendDispatch(
  dispatchSpec: NonNullable<ReturnType<typeof buildDispatchSpec>>,
  target: {
    readonly aggregateId: string;
    readonly tenantId: TenantId;
    readonly userId: string;
    readonly secrets: MultiStreamApplyContext["secrets"];
  },
): Promise<DeliveryResult> {
  try {
    return dispatchSpec.stepKind === "webhook.send"
      ? await performWebhookDispatch(dispatchSpec.spec, {
          tenantId: target.tenantId,
          userId: target.userId,
          secrets: target.secrets,
          idempotencyKey: target.aggregateId,
        })
      : await performMailDispatch(dispatchSpec.spec).then(mailResultAsDelivery);
  } catch (err) {
    // err.message can echo the url or an address; only the class name is logged.
    log.warn("step delivery threw", {
      aggregateId: target.aggregateId,
      errorName: err instanceof Error ? err.name : "unknown",
    });
    return { ok: false, error: DISPATCH_THREW_ERROR, retryable: true };
  }
}

async function abortOnFinalAttempt(
  err: unknown,
  ctx: MultiStreamApplyContext,
  recorder: OutcomeRecorder,
  aggregateId: string,
  requestedPayload: unknown,
): Promise<void> {
  // err.message can echo the url or an address; only the class name is logged.
  log.warn("step delivery aborted on the final attempt", {
    aggregateId,
    errorName: err instanceof Error ? err.name : "unknown",
  });
  try {
    // An outcome may already be appended when only the erase threw: repeat the
    // erase, never a second outcome.
    const current = await ctx.loadAggregate(aggregateId);
    if (current.some(isDispatchOutcome)) {
      await eraseDispatchKey(aggregateId);
    } else {
      await recorder.recordFailure(rawStepKindOf(requestedPayload), FINAL_ATTEMPT_ABORTED_ERROR);
    }
  } catch {
    throw new Error(FINAL_ATTEMPT_UNRECORDED_ERROR);
  }
}
