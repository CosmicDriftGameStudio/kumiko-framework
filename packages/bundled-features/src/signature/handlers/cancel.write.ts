import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { requestExecutor, signerExecutor } from "../entity.ts";
import { isUnsignedSigner, listSigners, setRequestStatus } from "../lib.ts";
import { RequestIdSchema } from "../payloads.ts";
import type { SubjectScope } from "../subject-scope.ts";
import { SIGNATURE_REQUEST_ENTITY, SIGNATURE_REQUEST_STATUS } from "../web/constants.ts";

// Cancelling moves the request out of `open`, which already makes every link of it fail; the
// anchors are cleared as well so no token verifies against a cancelled request.
export function createCancelHandler(access: AccessRule, scope: SubjectScope) {
  return defineWriteHandler<"cancel", typeof RequestIdSchema, { readonly cancelled: true }>({
    name: "cancel",
    schema: RequestIdSchema,
    access,
    agent: { risk: "mid" },
    description:
      "Cancels an open signature request; all its signing links stop working. Signatures already given stay on record.",
    handler: async (event, ctx) => {
      const user = event.user;
      if (scope.isScoped(user)) {
        const request = await requestExecutor.detail({ id: event.payload.requestId }, user, ctx.db);
        if (request === null || !(await scope.allowsRequest(ctx, user, request))) {
          return writeFailure(new NotFoundError(SIGNATURE_REQUEST_ENTITY, event.payload.requestId));
        }
      }
      const moved = await setRequestStatus(
        ctx,
        user,
        event.payload.requestId,
        SIGNATURE_REQUEST_STATUS.Open,
        { status: SIGNATURE_REQUEST_STATUS.Cancelled },
      );
      if (!moved.isSuccess) return moved;
      for (const signer of await listSigners(ctx, user, event.payload.requestId)) {
        if (!isUnsignedSigner(signer) || signer.linkAnchor == null) continue;
        const cleared = await signerExecutor.update(
          { id: signer.id, changes: { linkAnchor: null } },
          user,
          ctx.db,
          { skipOptimisticLock: true },
        );
        if (!cleared.isSuccess) return cleared;
      }
      return { isSuccess: true, data: { cancelled: true } };
    },
  });
}
