import {
  type AccessRule,
  buildUpdateSchema,
  defineWriteHandler,
  FIELD_CHANGE_REQUEST_ENTITY_NAME,
  fieldApproveRoles,
  normalizeAccessEntry,
  registeredEntityExecutor,
  userCanWriteFieldRow,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  FrameworkReasons,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { denyUnlessJoinRowParentVisible, unprocessable } from "../../shared/index.ts";
import { fieldChangeRequestAggregateId } from "../aggregate-id.ts";
import { FieldApprovalReasons, FieldChangeStatus } from "../constants.ts";
import type { fieldChangeRequestExecutor } from "../executor.ts";
import { requestFieldChangePayloadSchema } from "../schemas.ts";
import { sealRequestedValue } from "../stored-value.ts";
import { requesterIdOf } from "./decide-change.ts";

function isOpenRequestOfAnotherUser(
  request: Readonly<Record<string, unknown>> | null | undefined,
  userId: string,
): boolean {
  return request?.["status"] === FieldChangeStatus.Pending && requesterIdOf(request) !== userId;
}

export function createRequestChangeHandler(
  access: AccessRule,
  requestExecutor: typeof fieldChangeRequestExecutor,
) {
  return defineWriteHandler({
    name: "request-change",
    schema: requestFieldChangePayloadSchema,
    access,
    description:
      "Files a change of an approval-gated field for a second person to approve; use it when a direct write returned field_approval_required.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      const { entityType, entityId, fieldName } = payload;

      const denied = await denyUnlessJoinRowParentVisible(
        ctx.registry,
        FIELD_CHANGE_REQUEST_ENTITY_NAME,
        payload,
        event.user,
        ctx.db,
      );
      if (denied) return denied;

      const hostEntity = ctx.registry.getEntity(entityType);
      const field = hostEntity?.fields[fieldName];
      if (
        hostEntity === undefined ||
        field === undefined ||
        fieldApproveRoles(field).length === 0
      ) {
        return unprocessable(
          FieldApprovalReasons.fieldNotApprovalGated,
          "errors.validation.invalid",
          {
            field: fieldName,
          },
        );
      }

      const hostRow = await registeredEntityExecutor(ctx.registry, entityType)?.detail(
        { id: entityId },
        event.user,
        ctx.db,
      );
      if (!hostRow) return writeFailure(new NotFoundError(entityType, entityId));

      const parsed = buildUpdateSchema(hostEntity).shape[fieldName]?.safeParse(payload.value);
      if (parsed === undefined || !parsed.success) {
        return unprocessable(FieldApprovalReasons.invalidValue, "errors.validation.invalid", {
          field: fieldName,
        });
      }

      const writeMap = normalizeAccessEntry(field.access?.write);
      if (
        writeMap !== undefined &&
        !userCanWriteFieldRow(event.user, writeMap, hostRow, {
          ...hostRow,
          [fieldName]: parsed.data,
        })
      ) {
        return writeFailure(
          new AccessDeniedError({
            i18nKey: "errors.access.fieldDenied",
            details: { reason: FrameworkReasons.fieldAccessDenied, field: fieldName },
          }),
        );
      }

      // The requester must be allowed to update the host row; the approver's write only proves the
      // approver's right.
      if (
        !userCanWriteFieldRow(event.user, hostEntity.access?.write, hostRow, {
          ...hostRow,
          [fieldName]: parsed.data,
        })
      ) {
        return writeFailure(
          new UnprocessableError("ownership_denied", {
            i18nKey: "errors.ownershipDenied",
            details: {
              scope: "entity",
              entityName: entityType,
              action: "update",
              userId: event.user.id,
            },
          }),
        );
      }

      const id = fieldChangeRequestAggregateId(
        event.user.tenantId,
        entityType,
        entityId,
        fieldName,
      );
      const existing = await requestExecutor.detail({ id }, event.user, ctx.db);
      // Re-filing would make the caller the requester and drop the other person's request unseen.
      if (isOpenRequestOfAnotherUser(existing, event.user.id)) {
        return unprocessable(
          FieldApprovalReasons.requestPendingByOther,
          "errors.fieldApproval.requestPendingByOther",
          { field: fieldName },
        );
      }

      const requestedValue = await sealRequestedValue(
        hostEntity,
        entityType,
        fieldName,
        parsed.data,
        { ...hostRow, id: entityId },
      );

      // A new request overwrites the requester's own open value and bumps the version, so approve
      // and reject pin the version the approver saw. The update pins the version checked above: a
      // request filed by someone else in between must fail, not be replaced.
      const saved = existing
        ? await requestExecutor.update(
            {
              id,
              version: Number(existing["version"]),
              changes: { status: FieldChangeStatus.Pending, requestedValue },
            },
            event.user,
            ctx.db,
          )
        : await requestExecutor.create(
            {
              id,
              entityType,
              entityId,
              fieldName,
              status: FieldChangeStatus.Pending,
              requestedValue,
            },
            event.user,
            ctx.db,
          );
      if (!saved.isSuccess) return saved;
      return { isSuccess: true as const, data: { id } };
    },
  });
}
