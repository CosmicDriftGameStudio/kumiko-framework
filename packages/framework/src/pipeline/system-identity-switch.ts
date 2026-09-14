import { SYSTEM_ROLE, SYSTEM_USER_ID } from "../engine/system-user";
import type {
  ActiveMembershipResult,
  EscapeHatchDeclaration,
  LifecycleHookFn,
  SessionUser,
  WriteResult,
} from "../engine/types";
import type { TenantId } from "../engine/types/identifiers";
import { AccessDeniedError, FrameworkReasons, InternalError } from "../errors";

export type QueryAsFn = (user: SessionUser, qn: string, payload: unknown) => Promise<unknown>;
export type WriteAsFn = (user: SessionUser, qn: string, payload: unknown) => Promise<WriteResult>;
export type ResolveActiveMembershipFn = (
  userId: string,
  tenantId: TenantId,
) => Promise<ActiveMembershipResult>;
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

export function systemIdentitySwitchDenied(callerLabel: string): AccessDeniedError {
  return new AccessDeniedError({
    message:
      `${callerLabel} may not switch identity to SYSTEM — declare r.systemScope() or ` +
      "escapeHatch: { reason } on it",
    details: { reason: FrameworkReasons.systemIdentitySwitchDenied },
  });
}

// Reverse-lookup so withHookIdentitySwitchGrant can re-gate the SAME ungated pair under a narrower grant.
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

function readIdentitySwitchFn<TFn extends QueryAsFn | WriteAsFn | ResolveActiveMembershipFn>(
  context: object,
  key: "queryAs" | "writeAs" | "resolveActiveMembership",
): TFn | undefined {
  if (!(key in context)) return undefined;
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "function" ? (value as TFn) : undefined; // @cast-boundary engine-bridge — checked via typeof above
}

function unavailableIdentitySwitchFn(callerLabel: string, kind: "queryAs" | "writeAs") {
  return async () => {
    throw new InternalError({
      message: `${callerLabel}: this context has no ${kind} to switch identity with.`,
    });
  };
}

function deniedResolveActiveMembership(callerLabel: string): ResolveActiveMembershipFn {
  return async () => {
    throw systemIdentitySwitchDenied(callerLabel);
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

// Reuses the ORIGINAL ungated pair when known, so this grant doesn't compose with the caller's.
function gatedIdentitySwitchFields(
  callerLabel: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
  ctxQueryAs: QueryAsFn | undefined,
  ctxWriteAs: WriteAsFn | undefined,
): Partial<IdentitySwitch> {
  if (!ctxQueryAs && !ctxWriteAs) return {};
  const ungated: IdentitySwitch =
    (ctxQueryAs && ungatedByGated.get(ctxQueryAs)) ??
    (ctxWriteAs && ungatedByGated.get(ctxWriteAs)) ??
    fallbackUngatedIdentitySwitch(callerLabel, ctxQueryAs, ctxWriteAs);
  const gated = createGatedIdentitySwitch(callerLabel, escapeHatch !== undefined, ungated);
  return {
    ...(ctxQueryAs && { queryAs: gated.queryAs }),
    ...(ctxWriteAs && { writeAs: gated.writeAs }),
  };
}

export function withHookIdentitySwitchGrant<TContext extends object>(
  context: TContext,
  callerLabel: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
): TContext {
  const ctxQueryAs = readIdentitySwitchFn<QueryAsFn>(context, "queryAs");
  const ctxWriteAs = readIdentitySwitchFn<WriteAsFn>(context, "writeAs");
  const ctxResolveActiveMembership = readIdentitySwitchFn<ResolveActiveMembershipFn>(
    context,
    "resolveActiveMembership",
  );
  if (!ctxQueryAs && !ctxWriteAs && !ctxResolveActiveMembership) return context;

  return {
    ...context,
    ...gatedIdentitySwitchFields(callerLabel, escapeHatch, ctxQueryAs, ctxWriteAs),
    ...(ctxResolveActiveMembership &&
      escapeHatch === undefined && {
        resolveActiveMembership: deniedResolveActiveMembership(callerLabel),
      }),
  };
}

// Re-gates a hook's own ctx.queryAs/ctx.writeAs instead of inheriting the handler's grant.
export function bindHookIdentitySwitchGrant(
  fn: LifecycleHookFn,
  label: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
): LifecycleHookFn {
  return ((payload: unknown, context: object) =>
    (fn as (payload: unknown, context: object) => unknown)(
      payload,
      withHookIdentitySwitchGrant(context, label, escapeHatch),
    )) as LifecycleHookFn; // @cast-boundary engine-bridge — LifecycleHookFn union, same (payload, context) shape at runtime
}
