import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { requestExecutor } from "../entity.ts";
import {
  advanceIfAllSigned,
  appendOutcomeEvent,
  internalAccess,
  isPastInstant,
  listSigners,
  setRequestStatus,
} from "../lib.ts";
import { FailSchema, FinishSchema, RequestIdSchema } from "../payloads.ts";
import { SIGNATURE_REQUEST_STATUS, SignatureEvents } from "../web/constants.ts";

// The writes of the sweep job. They run as handlers because a job may only append its own
// events through ctx.events, and every transition here must also hold the "exactly once" precondition.
export const finishHandler = defineWriteHandler({
  name: "finish",
  schema: FinishSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: marks an all-signed request completed with its final PDF and emits the completed event once.",
  handler: async (event, ctx) => {
    const request = await requestExecutor.detail(
      { id: event.payload.requestId },
      event.user,
      ctx.db,
    );
    if (request === null) return { isSuccess: true, data: { finished: false } };
    const moved = await setRequestStatus(
      ctx,
      event.user,
      request.id,
      SIGNATURE_REQUEST_STATUS.AllSigned,
      {
        status: SIGNATURE_REQUEST_STATUS.Completed,
        completedFileId: event.payload.completedFileId,
        completedAt: ctx.tz.now(),
      },
    );
    if (!moved.isSuccess) return { isSuccess: true, data: { finished: false } };
    const signers = await listSigners(ctx, event.user, request.id);
    await appendOutcomeEvent(ctx, SignatureEvents.completed, {
      requestId: request.id,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      completedFileId: event.payload.completedFileId,
      signerCount: signers.length,
    });
    return { isSuccess: true, data: { finished: true } };
  },
});

export const expireHandler = defineWriteHandler({
  name: "expire",
  schema: RequestIdSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: expires an open request whose deadline has passed and emits the expired event once.",
  handler: async (event, ctx) => {
    const request = await requestExecutor.detail(
      { id: event.payload.requestId },
      event.user,
      ctx.db,
    );
    if (request === null || !isPastInstant(request.expiresAt, ctx.tz.now())) {
      return { isSuccess: true, data: { expired: false } };
    }
    const moved = await setRequestStatus(
      ctx,
      event.user,
      request.id,
      SIGNATURE_REQUEST_STATUS.Open,
      { status: SIGNATURE_REQUEST_STATUS.Expired },
    );
    if (!moved.isSuccess) return { isSuccess: true, data: { expired: false } };
    await appendOutcomeEvent(ctx, SignatureEvents.expired, {
      requestId: request.id,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
    });
    return { isSuccess: true, data: { expired: true } };
  },
});

export const failHandler = defineWriteHandler({
  name: "fail",
  schema: FailSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: ends an all-signed request that can never be completed (original changed or missing, signature image missing) as failed and emits the failed event once.",
  handler: async (event, ctx) => {
    const request = await requestExecutor.detail(
      { id: event.payload.requestId },
      event.user,
      ctx.db,
    );
    if (request === null) return { isSuccess: true, data: { failed: false } };
    const moved = await setRequestStatus(
      ctx,
      event.user,
      request.id,
      SIGNATURE_REQUEST_STATUS.AllSigned,
      { status: SIGNATURE_REQUEST_STATUS.Failed },
    );
    if (!moved.isSuccess) return { isSuccess: true, data: { failed: false } };
    await appendOutcomeEvent(ctx, SignatureEvents.failed, {
      requestId: request.id,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      reason: event.payload.reason,
    });
    return { isSuccess: true, data: { failed: true } };
  },
});

// Two last signers committing at the same moment can each still see the other as unsigned; the
// sweep repeats the check so such a request cannot stay open for good.
export const reconcileHandler = defineWriteHandler({
  name: "reconcile",
  schema: RequestIdSchema,
  access: internalAccess,
  agent: { expose: false },
  description: "Internal: moves an open request whose signers have all signed to all-signed.",
  handler: async (event, ctx) => ({
    isSuccess: true,
    data: { advanced: await advanceIfAllSigned(ctx, event.user, event.payload.requestId) },
  }),
});
