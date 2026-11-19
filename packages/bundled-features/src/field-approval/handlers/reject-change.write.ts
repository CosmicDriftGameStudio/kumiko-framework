import {
  type AccessRule,
  defineWriteHandler,
  userCanApproveField,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  FrameworkReasons,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { FieldChangeStatus } from "../constants.ts";
import type { fieldChangeRequestExecutor } from "../executor.ts";
import { decideFieldChangePayloadSchema } from "../schemas.ts";
import { isPendingRequest, loadPendingRequest, requesterIdOf } from "./decide-change.ts";

export function createRejectChangeHandler(
  access: AccessRule,
  requestExecutor: typeof fieldChangeRequestExecutor,
) {
  return defineWriteHandler({
    name: "reject-change",
    schema: decideFieldChangePayloadSchema,
    access,
    agent: { expose: false },
    description:
      "Rejects or withdraws a filed field change without touching the host record; callable by an approver of that field or by whoever filed the request.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      const pending = await loadPendingRequest(ctx, event.user, requestExecutor, payload.id);
      if (!isPendingRequest(pending)) return pending;
      const { request, fieldName, field } = pending;

      const isRequester = requesterIdOf(request) === event.user.id;
      if (!userCanApproveField(event.user, field) && !isRequester) {
        return writeFailure(
          new AccessDeniedError({
            i18nKey: "errors.access.denied",
            details: { reason: FrameworkReasons.fieldAccessDenied, field: fieldName },
          }),
        );
      }

      const decided = await requestExecutor.update(
        {
          id: payload.id,
          version: payload.version,
          changes: { status: FieldChangeStatus.Rejected, requestedValue: null },
        },
        event.user,
        ctx.db,
      );
      if (!decided.isSuccess) return decided;
      return { isSuccess: true as const, data: { id: payload.id } };
    },
  });
}
