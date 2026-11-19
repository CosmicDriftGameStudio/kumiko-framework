import {
  FIELD_CHANGE_REQUEST_ENTITY_NAME,
  type FieldDefinition,
  type HandlerContext,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { denyUnlessJoinRowParentVisible, unprocessable } from "../../shared/index.ts";
import { FieldApprovalReasons, FieldChangeStatus } from "../constants.ts";
import type { fieldChangeRequestExecutor } from "../executor.ts";

export type PendingRequest = {
  readonly request: Readonly<Record<string, unknown>>;
  readonly entityType: string;
  readonly entityId: string;
  readonly fieldName: string;
  readonly field: FieldDefinition;
};

export async function loadPendingRequest(
  ctx: HandlerContext,
  user: SessionUser,
  requestExecutor: typeof fieldChangeRequestExecutor,
  id: string,
): Promise<PendingRequest | WriteFailure> {
  const request = await requestExecutor.detail({ id }, user, ctx.db);
  if (!request) return writeFailure(new NotFoundError(FIELD_CHANGE_REQUEST_ENTITY_NAME, id));
  if (request["status"] !== FieldChangeStatus.Pending) {
    return unprocessable(FieldApprovalReasons.requestNotPending, "errors.validation.invalid");
  }
  const entityType = String(request["entityType"]);
  const entityId = String(request["entityId"]);
  const fieldName = String(request["fieldName"]);

  const denied = await denyUnlessJoinRowParentVisible(
    ctx.registry,
    FIELD_CHANGE_REQUEST_ENTITY_NAME,
    { entityType, entityId },
    user,
    ctx.db,
  );
  if (denied) return denied;

  const field = ctx.registry.getEntity(entityType)?.fields[fieldName];
  if (field === undefined) {
    return unprocessable(FieldApprovalReasons.fieldNotApprovalGated, "errors.validation.invalid", {
      field: fieldName,
    });
  }
  return { request, entityType, entityId, fieldName, field };
}

export function isPendingRequest(value: PendingRequest | WriteFailure): value is PendingRequest {
  return !("isSuccess" in value);
}

// A first request creates the row, which stamps only insertedById; a re-filed request updates it.
export function requesterIdOf(request: Readonly<Record<string, unknown>>): unknown {
  return request["modifiedById"] ?? request["insertedById"];
}
