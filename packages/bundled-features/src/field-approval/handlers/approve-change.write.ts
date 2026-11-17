import {
  type AccessRule,
  defineWriteHandler,
  registeredEntityExecutor,
  userCanApproveField,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  FrameworkReasons,
  InternalError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { unprocessable } from "../../shared/index.ts";
import { FieldApprovalReasons, FieldChangeStatus } from "../constants.ts";
import type { fieldChangeRequestExecutor } from "../executor.ts";
import { decideFieldChangePayloadSchema } from "../schemas.ts";
import { openRequestedValue } from "../stored-value.ts";
import { isPendingRequest, loadPendingRequest } from "./decide-change.ts";

export function createApproveChangeHandler(
  access: AccessRule,
  requestExecutor: typeof fieldChangeRequestExecutor,
) {
  return defineWriteHandler({
    name: "approve-change",
    schema: decideFieldChangePayloadSchema,
    access,
    // A human decides an approval; an agent must never approve its own or a colleague's request.
    agent: { expose: false, risk: "high" },
    description:
      "Applies a filed field change to its host record; only a different person holding an approve role of that field may call it, pinned to the request version they saw.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      const pending = await loadPendingRequest(ctx, event.user, requestExecutor, payload.id);
      if (!isPendingRequest(pending)) return pending;
      const { request, entityType, entityId, fieldName, field } = pending;

      if (!userCanApproveField(event.user, field)) {
        return writeFailure(
          new AccessDeniedError({
            i18nKey: "errors.access.denied",
            details: { reason: FrameworkReasons.fieldAccessDenied, field: fieldName },
          }),
        );
      }
      if (request["modifiedById"] === event.user.id) {
        return writeFailure(
          new AccessDeniedError({
            i18nKey: "errors.access.denied",
            details: { reason: FieldApprovalReasons.selfApproval },
          }),
        );
      }

      const opened = await openRequestedValue(request["requestedValue"], fieldName);
      if (!opened.ok) {
        return unprocessable(FieldApprovalReasons.valueErased, "errors.validation.invalid");
      }

      const decided = await requestExecutor.update(
        {
          id: payload.id,
          version: payload.version,
          changes: { status: FieldChangeStatus.Approved, requestedValue: null },
        },
        event.user,
        ctx.db,
      );
      if (!decided.isSuccess) return decided;

      const hostExecutor = registeredEntityExecutor(ctx.registry, entityType);
      if (!hostExecutor) {
        throw new InternalError({
          message: `field-approval: host entity ${entityType} has no executor`,
        });
      }
      // The host version is not pinned so unrelated edits cannot block an approval; the request
      // version is the pin. The approver passes the executor gate through their approve role.
      const applied = await hostExecutor.update(
        { id: entityId, changes: { [fieldName]: opened.value } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      );
      if (!applied.isSuccess) return applied;
      return { isSuccess: true as const, data: { id: payload.id } };
    },
  });
}
