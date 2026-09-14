import { SYSTEM_ROLE, SYSTEM_USER_ID } from "../engine/system-user";
import type {
  ActiveMembershipResult,
  EscapeHatchDeclaration,
  LifecycleHookFn,
  MemberReader,
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
// Same idea, for ctx.queryAsMember — a single function rather than a pair.
const ungatedMemberReaderByGated = new WeakMap<MemberReader, MemberReader>();

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

// ctx.queryAsMember's gate: the caller never names the target identity up
// front (it's resolved internally), so this is a flat allow/deny.
export function createGatedMemberReader(
  callerLabel: string,
  allowSystemIdentity: boolean,
  ungated: MemberReader,
): MemberReader {
  const gated: MemberReader = async (userId, qn, payload) => {
    if (!allowSystemIdentity) throw systemIdentitySwitchDenied(callerLabel);
    return ungated(userId, qn, payload);
  };
  ungatedMemberReaderByGated.set(gated, ungated);
  return gated;
}

function readIdentitySwitchFn<
  TFn extends QueryAsFn | WriteAsFn | ResolveActiveMembershipFn | MemberReader,
>(
  context: object,
  key: "queryAs" | "writeAs" | "resolveActiveMembership" | "queryAsMember",
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

// Reuses the ORIGINAL ungated fn when known, so this grant doesn't compose
// with the caller's. Resolved independently per function — a context can
// carry a live queryAs alongside a deny-stubbed writeAs (member-resolution
// contexts), and reusing one shared ungated pair for both would revive the
// stub through the still-registered queryAs side.
function gatedIdentitySwitchFields(
  callerLabel: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
  ctxQueryAs: QueryAsFn | undefined,
  ctxWriteAs: WriteAsFn | undefined,
): Partial<IdentitySwitch> {
  if (!ctxQueryAs && !ctxWriteAs) return {};
  const ungatedQueryAs = ctxQueryAs && (ungatedByGated.get(ctxQueryAs)?.queryAs ?? ctxQueryAs);
  const ungatedWriteAs = ctxWriteAs && (ungatedByGated.get(ctxWriteAs)?.writeAs ?? ctxWriteAs);
  const ungated = fallbackUngatedIdentitySwitch(callerLabel, ungatedQueryAs, ungatedWriteAs);
  const gated = createGatedIdentitySwitch(callerLabel, escapeHatch !== undefined, ungated);
  return {
    ...(ctxQueryAs && { queryAs: gated.queryAs }),
    ...(ctxWriteAs && { writeAs: gated.writeAs }),
  };
}

// Unlike ctx.resolveActiveMembership (deny-only), a hook's own escapeHatch
// can grant queryAsMember even when the enclosing handler has none.
function gatedMemberReaderField(
  callerLabel: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
  ctxQueryAsMember: MemberReader | undefined,
): { queryAsMember?: MemberReader } {
  if (!ctxQueryAsMember) return {};
  const ungated = ungatedMemberReaderByGated.get(ctxQueryAsMember) ?? ctxQueryAsMember;
  return {
    queryAsMember: createGatedMemberReader(callerLabel, escapeHatch !== undefined, ungated),
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
  const ctxQueryAsMember = readIdentitySwitchFn<MemberReader>(context, "queryAsMember");
  if (!ctxQueryAs && !ctxWriteAs && !ctxResolveActiveMembership && !ctxQueryAsMember) {
    return context;
  }

  return {
    ...context,
    ...gatedIdentitySwitchFields(callerLabel, escapeHatch, ctxQueryAs, ctxWriteAs),
    ...(ctxResolveActiveMembership &&
      escapeHatch === undefined && {
        resolveActiveMembership: deniedResolveActiveMembership(callerLabel),
      }),
    ...gatedMemberReaderField(callerLabel, escapeHatch, ctxQueryAsMember),
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
