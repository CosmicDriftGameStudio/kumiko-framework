import { type TenantDb, withUnsafeRawGrant } from "../db/tenant-db";
import { SYSTEM_ROLE, SYSTEM_USER_ID } from "../engine/system-user";
import type {
  EscapeHatchDeclaration,
  LifecycleHookFn,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { AccessDeniedError, FrameworkReasons, InternalError } from "../errors";

export type QueryAsFn = (user: SessionUser, qn: string, payload: unknown) => Promise<unknown>;
export type WriteAsFn = (user: SessionUser, qn: string, payload: unknown) => Promise<WriteResult>;
export type IdentitySwitch = { readonly queryAs: QueryAsFn; readonly writeAs: WriteAsFn };

export function isSystemIdentity(user: SessionUser): boolean {
  return user.id === SYSTEM_USER_ID || user.roles.includes(SYSTEM_ROLE);
}

export function isSystemIdentitySwitchAllowed(
  asUser: SessionUser,
  allowSystemIdentity: boolean,
): boolean {
  return !isSystemIdentity(asUser) || allowSystemIdentity;
}

function systemIdentitySwitchDenied(callerLabel: string): AccessDeniedError {
  return new AccessDeniedError({
    message:
      `${callerLabel} may not switch identity to SYSTEM — declare r.systemScope() or ` +
      "escapeHatch: { reason } on it",
    details: { reason: FrameworkReasons.systemIdentitySwitchDenied },
  });
}

// Reverse-lookup so withHookEscapeHatchGrant can re-gate the SAME ungated pair under a narrower grant.
const ungatedByGated = new WeakMap<QueryAsFn | WriteAsFn, IdentitySwitch>();

export function createGatedIdentitySwitch(
  callerLabel: string,
  allowSystemIdentity: boolean,
  ungated: IdentitySwitch,
): IdentitySwitch {
  const queryAs: QueryAsFn = async (asUser, qn, payload) => {
    if (!isSystemIdentitySwitchAllowed(asUser, allowSystemIdentity)) {
      throw systemIdentitySwitchDenied(callerLabel);
    }
    return ungated.queryAs(asUser, qn, payload);
  };
  const writeAs: WriteAsFn = async (asUser, qn, payload) => {
    if (!isSystemIdentitySwitchAllowed(asUser, allowSystemIdentity)) {
      throw systemIdentitySwitchDenied(callerLabel);
    }
    return ungated.writeAs(asUser, qn, payload);
  };
  const gated: IdentitySwitch = { queryAs, writeAs };
  ungatedByGated.set(queryAs, ungated);
  ungatedByGated.set(writeAs, ungated);
  return gated;
}

function readIdentitySwitchFn<TFn extends QueryAsFn | WriteAsFn>(
  context: object,
  key: "queryAs" | "writeAs",
): TFn | undefined {
  if (!(key in context)) return undefined;
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "function" ? (value as TFn) : undefined; // @cast-boundary engine-bridge — checked via typeof above
}

// context's own keys only — never touch a property of the resolved value, which may be a Proxy that throws on any get.
function readDbLikeValue(context: object, key: "db" | "dbOutsideTransaction"): object | undefined {
  if (!(key in context)) return undefined;
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null ? value : undefined;
}

function unavailableIdentitySwitchFn(callerLabel: string, kind: "queryAs" | "writeAs") {
  return async () => {
    throw new InternalError({
      message: `${callerLabel}: this context has no ${kind} to switch identity with.`,
    });
  };
}

// Fail-closed fallback for a ctx not built by the dispatcher bridge (unit-test stub, duplicated module instance).
function fallbackUngatedIdentitySwitch(
  callerLabel: string,
  ctxQueryAs: QueryAsFn | undefined,
  ctxWriteAs: WriteAsFn | undefined,
): IdentitySwitch {
  return {
    queryAs: ctxQueryAs ?? unavailableIdentitySwitchFn(callerLabel, "queryAs"),
    writeAs: ctxWriteAs ?? unavailableIdentitySwitchFn(callerLabel, "writeAs"),
  };
}

export function withHookEscapeHatchGrant<TContext extends object>(
  context: TContext,
  callerLabel: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
): TContext {
  const ctxQueryAs = readIdentitySwitchFn<QueryAsFn>(context, "queryAs");
  const ctxWriteAs = readIdentitySwitchFn<WriteAsFn>(context, "writeAs");
  const ctxDb = readDbLikeValue(context, "db");
  const ctxDbOutsideTransaction = readDbLikeValue(context, "dbOutsideTransaction");
  if (!ctxQueryAs && !ctxWriteAs && !ctxDb && !ctxDbOutsideTransaction) return context;

  // Reuse the ORIGINAL ungated pair when known, so this grant doesn't compose with the caller's.
  const ungated: IdentitySwitch =
    (ctxQueryAs && ungatedByGated.get(ctxQueryAs)) ??
    (ctxWriteAs && ungatedByGated.get(ctxWriteAs)) ??
    fallbackUngatedIdentitySwitch(callerLabel, ctxQueryAs, ctxWriteAs);

  const gated = createGatedIdentitySwitch(callerLabel, escapeHatch !== undefined, ungated);
  return {
    ...context,
    ...(ctxQueryAs && { queryAs: gated.queryAs }),
    ...(ctxWriteAs && { writeAs: gated.writeAs }),
    // @cast-boundary engine-bridge — withUnsafeRawGrant passes non-TenantDb values (e.g. a guard Proxy) through unchanged.
    ...(ctxDb && { db: withUnsafeRawGrant(ctxDb as TenantDb, escapeHatch) }),
    ...(ctxDbOutsideTransaction && {
      dbOutsideTransaction: withUnsafeRawGrant(ctxDbOutsideTransaction as TenantDb, escapeHatch),
    }),
  };
}

// Re-gates a hook's own ctx.queryAs/ctx.writeAs/ctx.db/ctx.dbOutsideTransaction instead of inheriting the handler's grant.
export function bindHookEscapeHatchGrant(
  fn: LifecycleHookFn,
  label: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
): LifecycleHookFn {
  return ((payload: unknown, context: object) =>
    (fn as (payload: unknown, context: object) => unknown)(
      payload,
      withHookEscapeHatchGrant(context, label, escapeHatch),
    )) as LifecycleHookFn; // @cast-boundary engine-bridge — LifecycleHookFn union, same (payload, context) shape at runtime
}
