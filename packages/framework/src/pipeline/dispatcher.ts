import { hasAccess } from "../engine/access";
import { type ErrorCode, ErrorCodes } from "../engine/constants";
import { FrameworkError } from "../engine/errors";
import { checkWriteFields, filterReadFields } from "../engine/field-access";
import type {
  AppContext,
  HandlerContext,
  HandlerRef,
  LifecycleResult,
  Registry,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { runValidation } from "../engine/validation";
import type { EventLog } from "./event-log";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecycleHooks } from "./lifecycle-pipeline";

export type JobRunnerRef = {
  handleEvent: (
    eventName: string,
    payload: Record<string, unknown>,
    user?: SessionUser,
  ) => Promise<void>;
};

export type DispatcherOptions = {
  idempotency?: IdempotencyGuard;
  eventLog?: EventLog;
  lifecycle?: LifecycleHooks;
  jobRunner?: JobRunnerRef;
};

type HandlerType = string | HandlerRef;

function resolveType(type: HandlerType): string {
  return typeof type === "string" ? type : type.name;
}

export type Dispatcher = {
  write(
    type: HandlerType,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ): Promise<WriteResult>;
  query(type: HandlerType, payload: unknown, user: SessionUser): Promise<unknown>;
  command(type: HandlerType, payload: unknown, user: SessionUser): Promise<void>;
};

export function createDispatcher(
  registry: Registry,
  context: AppContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, eventLog, lifecycle, jobRunner } = options;

  async function logEvent(type: string, payload: unknown, user: SessionUser): Promise<void> {
    if (!eventLog) return;
    await eventLog.append({
      type,
      payload: (payload ?? {}) as Record<string, unknown>,
      userId: user.id,
      tenantId: user.tenantId,
    });
  }

  function buildHandlerContext(type: string, user: SessionUser): HandlerContext {
    return { ...context, _userId: user.id, _handlerType: type } as HandlerContext;
  }

  async function runLifecycle(
    type: string,
    data: unknown,
    handlerContext: HandlerContext,
  ): Promise<void> {
    if (!lifecycle || !data || typeof data !== "object" || !("kind" in data)) return;
    const result = data as LifecycleResult;
    if (result.kind === "save") {
      await lifecycle.runPostSave(type, result, handlerContext);
    } else if (result.kind === "delete") {
      await lifecycle.runPreDelete(type, result, handlerContext);
      await lifecycle.runPostDelete(type, result, handlerContext);
    }
  }

  // Shared write pipeline: validates, executes handler, runs lifecycle + side effects.
  // Used by both write() and command().
  async function executeWrite(
    type: string,
    payload: unknown,
    user: SessionUser,
  ): Promise<WriteResult> {
    const handler = registry.getWriteHandler(type);
    if (!handler) return { isSuccess: false, error: `${ErrorCodes.handlerNotFound}: ${type}` };

    if (handler.access && !hasAccess(user, handler.access)) {
      return { isSuccess: false, error: `${ErrorCodes.accessDenied}: ${type}` };
    }

    const parsed = handler.schema.safeParse(payload);
    if (!parsed.success) {
      return { isSuccess: false, error: `${ErrorCodes.validationFailed}: ${parsed.error.message}` };
    }

    const hookErrors = runValidation(registry, type, parsed.data as Record<string, unknown>);
    if (hookErrors) {
      const messages = hookErrors.map((e) => `${e.field}: ${e.error}`).join(", ");
      return { isSuccess: false, error: `${ErrorCodes.validationHook}: ${messages}` };
    }

    // Field-level write access check
    const entityName = registry.getHandlerEntity(type);
    if (entityName) {
      const entity = registry.getEntity(entityName);
      if (entity) {
        const fieldsToCheck = (parsed.data as Record<string, unknown>)["changes"] as
          | Record<string, unknown>
          | undefined;
        const writePayload = fieldsToCheck ?? (parsed.data as Record<string, unknown>);
        const deniedField = checkWriteFields(entity, writePayload, user);
        if (deniedField) {
          return { isSuccess: false, error: `${ErrorCodes.fieldAccessDenied}: ${deniedField}` };
        }
      }
    }

    const handlerContext = buildHandlerContext(type, user);
    const result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

    if (result.isSuccess) {
      await runLifecycle(type, result.data, handlerContext);

      if (jobRunner) {
        await jobRunner.handleEvent(type, (parsed.data ?? {}) as Record<string, unknown>, user);
      }
    }

    await logEvent(type, parsed.data, user);
    return result;
  }

  return {
    async write(typeOrRef, payload, user, requestId?) {
      const type = resolveType(typeOrRef);

      if (requestId && idempotency) {
        const cached = await idempotency.check(requestId);
        if (cached) return JSON.parse(cached) as WriteResult;
      }

      const result = await executeWrite(type, payload, user);

      if (requestId && idempotency) {
        await idempotency.store(requestId, result);
      }

      return result;
    },

    async query(typeOrRef, payload, user) {
      const type = resolveType(typeOrRef);
      const handler = registry.getQueryHandler(type);
      if (!handler) throw new FrameworkError(ErrorCodes.handlerNotFound, type);

      if (handler.access && !hasAccess(user, handler.access)) {
        throw new FrameworkError(ErrorCodes.accessDenied, type);
      }

      const parsed = handler.schema.safeParse(payload);
      if (!parsed.success) {
        throw new FrameworkError(ErrorCodes.validationFailed, parsed.error.message);
      }

      let result = await handler.handler(
        { type, payload: parsed.data, user },
        context as HandlerContext,
      );

      // Field-level read filter
      const entityName = registry.getHandlerEntity(type);
      if (entityName) {
        const entity = registry.getEntity(entityName);
        if (entity && result && typeof result === "object") {
          if (Array.isArray(result)) {
            result = result.map((row: Record<string, unknown>) =>
              filterReadFields(entity, row, user),
            );
          } else if ("rows" in (result as Record<string, unknown>)) {
            const r = result as { rows: Record<string, unknown>[]; nextCursor: string | null };
            result = {
              ...r,
              rows: r.rows.map((row) => filterReadFields(entity, row, user)),
            };
          } else {
            result = filterReadFields(entity, result as Record<string, unknown>, user);
          }
        }
      }

      await logEvent(type, parsed.data, user);
      return result;
    },

    async command(typeOrRef, payload, user) {
      const type = resolveType(typeOrRef);
      const result = await executeWrite(type, payload, user);

      if (!result.isSuccess) {
        // Error format: "error_code: detail" — extract code for proper HTTP status
        const colonIdx = result.error.indexOf(": ");
        const code = colonIdx > 0 ? result.error.slice(0, colonIdx) : result.error;
        const detail = colonIdx > 0 ? result.error.slice(colonIdx + 2) : undefined;
        throw new FrameworkError(code as ErrorCode, detail);
      }
    },
  };
}
