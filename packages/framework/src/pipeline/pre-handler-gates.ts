import type { DbRow } from "../db/connection.js";
import { hasAccess } from "../engine/access.js";
import { tenantOverrideDenied } from "../engine/cross-tenant.js";
import { checkWriteFieldRoles } from "../engine/field-access.js";
import type { SessionUser, WriteHandlerDef } from "../engine/types/index.js";
import { runValidation } from "../engine/validation.js";
import {
  AccessDeniedError,
  FrameworkReasons,
  isKumikoError,
  ValidationError,
  validationErrorFromZod,
  type WriteFailure,
  writeFailure,
} from "../errors/index.js";
import type { DispatchContext } from "./dispatch-shared.js";
import {
  checkFeatureEnabled,
  enforcePayloadRateLimits,
  enforceRateLimit,
} from "./dispatch-shared.js";
import { handlerAccessError } from "./handler-access-error.js";

// "charge" is the first pass of a command and bills rate-limit buckets. "recheck" repeats the same
// gates inside the transaction against the state the handler will see, without billing again.
export type PreHandlerGateMode = "charge" | "recheck";

export type PreHandlerGateResult =
  | { readonly isSuccess: true; readonly payload: unknown }
  | WriteFailure;

async function rejectDisabledFeature(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
): Promise<WriteFailure | undefined> {
  const disabledErr = await checkFeatureEnabled(ctx, type, user.tenantId);
  return disabledErr ? writeFailure(disabledErr) : undefined;
}

async function rejectRateLimited(
  ctx: DispatchContext,
  handler: WriteHandlerDef,
  type: string,
  user: SessionUser,
): Promise<WriteFailure | undefined> {
  try {
    await enforceRateLimit(
      ctx,
      handler.rateLimit,
      type,
      user,
      ctx.registry.isHandlerSystemScoped(type),
    );
  } catch (e) {
    if (isKumikoError(e)) return writeFailure(e);
    throw e;
  }
  return undefined;
}

async function rejectPayloadRateLimited(
  ctx: DispatchContext,
  handler: WriteHandlerDef,
  type: string,
  user: SessionUser,
  payload: unknown,
): Promise<WriteFailure | undefined> {
  try {
    await enforcePayloadRateLimits(ctx, handler.additionalRateLimits, type, user, payload);
  } catch (e) {
    if (isKumikoError(e)) return writeFailure(e);
    throw e;
  }
  return undefined;
}

function rejectInvalidByHooks(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
): WriteFailure | undefined {
  const hookErrors = runValidation(ctx.registry, type, payload as DbRow); // @cast-boundary engine-payload
  if (!hookErrors) return undefined;
  return writeFailure(
    new ValidationError({
      fields: hookErrors.map((e) => ({
        path: e.field,
        code: e.error,
        i18nKey: `errors.validation.${e.error}`,
      })),
    }),
  );
}

// Role-only gate; ownership-level row matching runs later in the executor where oldRow is loaded,
// so updates with partial changes still pass here and get their full evaluation at save time.
function rejectDeniedFieldRoles(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
): WriteFailure | undefined {
  const { registry } = ctx;
  const entityName = registry.getHandlerEntity(type);
  const entity = entityName ? registry.getEntity(entityName) : undefined;
  if (!entity) return undefined;
  const fieldsToCheck = (payload as DbRow)["changes"] as Record<string, unknown> | undefined; // @cast-boundary engine-payload
  const writePayload = fieldsToCheck ?? (payload as DbRow); // @cast-boundary engine-payload
  const deniedField = checkWriteFieldRoles(entity, writePayload, user);
  if (!deniedField) return undefined;
  return writeFailure(
    new AccessDeniedError({
      message: `field access denied: ${deniedField}`,
      i18nKey: "errors.access.fieldDenied",
      details: {
        reason: FrameworkReasons.fieldAccessDenied,
        field: deniedField,
        handler: type,
      },
    }),
  );
}

async function rejectBeforeParse(
  ctx: DispatchContext,
  handler: WriteHandlerDef,
  type: string,
  user: SessionUser,
  mode: PreHandlerGateMode,
): Promise<WriteFailure | undefined> {
  const disabled = await rejectDisabledFeature(ctx, type, user);
  if (disabled) return disabled;
  if (mode === "charge") {
    const rateLimited = await rejectRateLimited(ctx, handler, type, user);
    if (rateLimited) return rateLimited;
  }
  // Default-deny: boot validation refuses handlers without an access rule, so this only guards
  // against a handler injected at runtime.
  if (!hasAccess(user, handler.access)) return writeFailure(handlerAccessError(user, type));
  return undefined;
}

async function rejectAfterParse(
  ctx: DispatchContext,
  handler: WriteHandlerDef,
  type: string,
  user: SessionUser,
  payload: unknown,
  mode: PreHandlerGateMode,
): Promise<WriteFailure | undefined> {
  const overrideDenied = tenantOverrideDenied(user, payload);
  if (overrideDenied) return writeFailure(overrideDenied);
  if (mode === "charge") {
    const rateLimited = await rejectPayloadRateLimited(ctx, handler, type, user, payload);
    if (rateLimited) return rateLimited;
  }
  return (
    rejectInvalidByHooks(ctx, type, payload) ?? rejectDeniedFieldRoles(ctx, type, payload, user)
  );
}

// Every check that runs before a write handler may do work, in dispatch order. A handler that
// reserves capacity must only reserve for callers who passed all of them.
export async function runPreHandlerGates(
  ctx: DispatchContext,
  handler: WriteHandlerDef,
  type: string,
  rawPayload: unknown,
  user: SessionUser,
  mode: PreHandlerGateMode,
): Promise<PreHandlerGateResult> {
  const beforeParse = await rejectBeforeParse(ctx, handler, type, user, mode);
  if (beforeParse) return beforeParse;
  const parsed = handler.schema.safeParse(rawPayload);
  if (!parsed.success) return writeFailure(validationErrorFromZod(parsed.error));
  const afterParse = await rejectAfterParse(ctx, handler, type, user, parsed.data, mode);
  if (afterParse) return afterParse;
  return { isSuccess: true, payload: parsed.data };
}
