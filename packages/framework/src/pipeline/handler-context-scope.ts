import {
  type EscapeHatchDeclaration,
  type EscapeHatchReporter,
  escapeHatchFor,
} from "@cosmicdrift/kumiko-types/handlers";
import { requestContext } from "../api/request-context.ts";
import type { RequestContextData } from "../api/request-context-internals.ts";

import type { DbConnection, DbTx } from "../db/connection.ts";
import type {
  AppContext,
  HandlerContext,
  HandlerLifecycle,
  Registry,
  SessionUser,
} from "../engine/types/index.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { createEscapeHatchReporter } from "../observability/escape-hatch-report.ts";

import type { ContextServiceOverrides } from "./context-services.ts";
import {
  type DispatchContext,
  type HandlerTransactionScope,
  resolveDbSource,
} from "./dispatch-shared.ts";
import type { WriteOrigin } from "./write-origin.ts";

export type HandlerContextScope = {
  readonly ctx: DispatchContext;
  readonly type: string;
  readonly user: SessionUser;
  readonly origin: WriteOrigin;
  readonly tx: DbTx | undefined;
  readonly transactionScope: HandlerTransactionScope;
  readonly registry: Registry;
  readonly context: AppContext;
  readonly isSystem: boolean;
  readonly dbSource: DbConnection | DbTx | undefined;
  readonly reqCtx: RequestContextData | undefined;
  readonly writeEscapeHatch: EscapeHatchDeclaration | undefined;
  readonly handlerEscapeHatch: EscapeHatchDeclaration | undefined;
  readonly isWriteHandler: boolean;
  readonly isPerCommand: boolean;
  readonly denyDbWrites: boolean;
  readonly featureName: string | undefined;
  readonly hasIdentitySwitchGrant: boolean;
  readonly reportEscapeHatch: EscapeHatchReporter;
  readonly identitySwitchAudit: {
    readonly reason: string | undefined;
    readonly report: EscapeHatchReporter;
  };
};

export function resolveHandlerContextScope(input: {
  readonly ctx: DispatchContext;
  readonly type: string;
  readonly user: SessionUser;
  readonly origin: WriteOrigin;
  readonly tx: DbTx | undefined;
  readonly transactionScope: HandlerTransactionScope;
}): HandlerContextScope {
  const { ctx, type, user, origin, tx, transactionScope } = input;
  const { registry, appContext: context } = ctx;
  const isSystem = registry.isHandlerSystemScoped(type);
  // The outer dispatcher receives a DbConnection from the server/stack;
  // AppContext's `db` union also allows TenantDb (for downstream hook calls),
  // but at this point we're the root of the pipeline — cast is safe.
  const dbSource = resolveDbSource(ctx, tx);
  const reqCtx = requestContext.get();
  // global() writes are write-handler-only; SYSTEM identity switch and unsafeRaw accept write, query or stream escapeHatch.
  const writeHandler = registry.getWriteHandler(type);
  const writeEscapeHatch = writeHandler?.escapeHatch;
  const isPerCommand = writeHandler?.transaction === "perCommand";
  const denyDbWrites = transactionScope === "withoutTransaction";
  const handlerEscapeHatch =
    writeEscapeHatch ??
    registry.getQueryHandler(type)?.escapeHatch ??
    registry.getStreamHandler(type)?.escapeHatch;
  const identitySwitchEscapeHatch = escapeHatchFor(handlerEscapeHatch, "systemIdentity");
  const hasIdentitySwitchGrant = isSystem || identitySwitchEscapeHatch !== undefined;
  const featureName = registry.getHandlerFeature(type);
  const reportEscapeHatch = createEscapeHatchReporter({
    handler: type,
    tenantId: user.tenantId,
    actor: user.id,
    sink: context._escapeHatchAuditSink,
    log: context.log ?? createFallbackLogger("dispatcher"),
    window: ctx.escapeHatchReportWindow,
    meter: context.meter,
  });
  const identitySwitchGrantReason =
    identitySwitchEscapeHatch?.reason ??
    (isSystem ? `r.systemScope() feature "${featureName ?? "unknown"}"` : undefined);
  return {
    ctx,
    type,
    user,
    origin,
    tx,
    transactionScope,
    registry,
    context,
    isSystem,
    dbSource,
    reqCtx,
    writeEscapeHatch,
    handlerEscapeHatch,
    isWriteHandler: writeHandler !== undefined,
    isPerCommand,
    denyDbWrites,
    featureName,
    hasIdentitySwitchGrant,
    reportEscapeHatch,
    identitySwitchAudit: { reason: identitySwitchGrantReason, report: reportEscapeHatch },
  };
}

// preSave hooks need `changes`/`previous`/`isNew`, which only exist once
// a handler actually starts building its write — bound here so entity
// CRUD handlers (entity-handlers.ts) can forward it to the executor. The hooks receive the
// final, phase-wrapped context, so the context is resolved lazily at call time.
export function buildPreSave(
  scope: HandlerContextScope,
  finalContext: () => HandlerContext,
): HandlerLifecycle["runPreSave"] {
  const { lifecycle } = scope.ctx;
  if (!lifecycle) return undefined;
  return (handlerName, changes, previous, isNew) =>
    lifecycle.runPreSave(handlerName, changes, previous, isNew, finalContext());
}

// Services the dispatcher resolves itself instead of copying from the boot context.
export function buildRuntimeServices(scope: HandlerContextScope): ContextServiceOverrides {
  const { effectiveFeatures, jobRunner, cacheSync } = scope.ctx;
  return {
    // One resolver for the lifecycle pipeline, MSP runner and ctx.hasFeature.
    ...(effectiveFeatures && { effectiveFeatures }),
    ...(cacheSync && { cacheSync }),
    // Lets write handlers call ctx.services.jobRunner.dispatch(...) directly, same
    // as a follow-up job would (test-stack.ts wires the matching runner).
    ...(jobRunner && { jobRunner }),
  };
}

// Cancellation signal flows from the HTTP middleware via requestContext. Absent for non-HTTP
// entry points (jobs, dispatcher MSP-applies) so it never reads as a phantom always-live signal.
export function buildLifecycleSignal(scope: HandlerContextScope): {
  readonly signal?: AbortSignal;
} {
  return scope.reqCtx?.signal ? { signal: scope.reqCtx.signal } : {};
}
