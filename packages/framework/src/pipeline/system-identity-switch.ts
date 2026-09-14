import { type TenantDb, withUnsafeRawGrant } from "../db/tenant-db";
import { SYSTEM_ROLE, SYSTEM_USER_ID } from "../engine/system-user";
import type {
  ActiveMembershipResult,
  EscapeHatchDeclaration,
  EscapeHatchReporter,
  HandlerContext,
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
export type ProjectionReader = HandlerContext["queryProjection"];
export type IdentitySwitch = { readonly queryAs: QueryAsFn; readonly writeAs: WriteAsFn };
export type IdentitySwitchAudit = {
  readonly reason: string | undefined;
  readonly report: EscapeHatchReporter;
};

export function isSystemIdentity(user: SessionUser): boolean {
  return user.id === SYSTEM_USER_ID || user.roles.includes(SYSTEM_ROLE);
}

function hasSameClaims(caller: SessionUser, asUser: SessionUser): boolean {
  if (caller.claims === asUser.claims) return true;
  const callerClaims = caller.claims ?? {};
  const asUserClaims = asUser.claims ?? {};
  const keys = Object.keys(callerClaims);
  if (keys.length !== Object.keys(asUserClaims).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(asUserClaims, key) &&
      JSON.stringify(callerClaims[key]) === JSON.stringify(asUserClaims[key]),
  );
}

// claims drive ownership row filters and origin makes a ctx read-only, so both must match exactly.
export function isSelfDelegation(caller: SessionUser, asUser: SessionUser): boolean {
  return (
    asUser.id === caller.id &&
    asUser.tenantId === caller.tenantId &&
    asUser.origin === caller.origin &&
    asUser.roles.every((role) => caller.roles.includes(role)) &&
    hasSameClaims(caller, asUser)
  );
}

export function isIdentitySwitchAllowed(
  caller: SessionUser | undefined,
  asUser: SessionUser,
  hasGrant: boolean,
): boolean {
  if (hasGrant) return true;
  if (isSystemIdentity(asUser) || caller === undefined) return false;
  return isSelfDelegation(caller, asUser);
}

export function systemIdentitySwitchDenied(callerLabel: string): AccessDeniedError {
  return new AccessDeniedError({
    message:
      `${callerLabel} may not switch identity to SYSTEM — declare r.systemScope() or ` +
      "escapeHatch: { reason } on it",
    details: { reason: FrameworkReasons.systemIdentitySwitchDenied },
  });
}

export function identitySwitchDenied(callerLabel: string, asUser: SessionUser): AccessDeniedError {
  if (isSystemIdentity(asUser)) return systemIdentitySwitchDenied(callerLabel);
  return new AccessDeniedError({
    message:
      `${callerLabel} may only switch identity to its own caller (same user, tenant, claims and ` +
      "a subset of its roles) — declare r.systemScope() or escapeHatch: { reason } on it",
    details: { reason: FrameworkReasons.identitySwitchDenied },
  });
}

export function unsafeAllTenantsDenied(callerLabel: string): AccessDeniedError {
  return new AccessDeniedError({
    message:
      `${callerLabel} may not call ctx.queryProjection(..., { unsafeAllTenants: true }) — declare ` +
      "r.systemScope() or escapeHatch: { reason } on it",
    details: { reason: FrameworkReasons.unsafeAllTenantsDenied },
  });
}

type GatedIdentitySwitchSource = {
  readonly ungated: IdentitySwitch;
  readonly caller: SessionUser | undefined;
  readonly report?: EscapeHatchReporter;
};

type MemberReaderAudit = IdentitySwitchAudit & { readonly tenantId: TenantId };

type GatedMemberReaderSource = {
  readonly ungated: MemberReader;
  readonly audit?: MemberReaderAudit;
};

// Reverse-lookup so withHookEscapeHatchGrant can re-gate the SAME ungated pair (and caller) under a narrower grant.
const sourceByGated = new WeakMap<QueryAsFn | WriteAsFn, GatedIdentitySwitchSource>();
// Same idea, for ctx.queryAsMember — a single function rather than a pair.
const ungatedMemberReaderByGated = new WeakMap<MemberReader, GatedMemberReaderSource>();

function reportGrantedSwitch(
  caller: SessionUser | undefined,
  asUser: SessionUser,
  hasGrant: boolean,
  audit: IdentitySwitchAudit | undefined,
): void {
  // skip: no audit wired, switch wasn't grant-gated, or grant carries no reason to report
  if (!audit || !hasGrant || audit.reason === undefined) return;
  // skip: caller switching to themselves isn't a privilege escalation worth auditing
  if (caller !== undefined && isSelfDelegation(caller, asUser)) return;
  audit.report("identity-switch", audit.reason, { id: asUser.id, tenantId: asUser.tenantId });
}

export function createGatedIdentitySwitch(
  callerLabel: string,
  caller: SessionUser | undefined,
  hasGrant: boolean,
  ungated: IdentitySwitch,
  audit?: IdentitySwitchAudit,
): IdentitySwitch {
  const queryAs: QueryAsFn = async (asUser, qn, payload) => {
    if (!isIdentitySwitchAllowed(caller, asUser, hasGrant)) {
      throw identitySwitchDenied(callerLabel, asUser);
    }
    reportGrantedSwitch(caller, asUser, hasGrant, audit);
    return ungated.queryAs(asUser, qn, payload);
  };
  const writeAs: WriteAsFn = async (asUser, qn, payload) => {
    if (!isIdentitySwitchAllowed(caller, asUser, hasGrant)) {
      throw identitySwitchDenied(callerLabel, asUser);
    }
    reportGrantedSwitch(caller, asUser, hasGrant, audit);
    return ungated.writeAs(asUser, qn, payload);
  };
  const gated: IdentitySwitch = { queryAs, writeAs };
  const source: GatedIdentitySwitchSource = { ungated, caller, report: audit?.report };
  sourceByGated.set(queryAs, source);
  sourceByGated.set(writeAs, source);
  return gated;
}

// ctx.queryAsMember's gate: the caller never names the target identity up
// front (it's resolved internally), so this is a flat allow/deny.
export function createGatedMemberReader(
  callerLabel: string,
  allowSystemIdentity: boolean,
  ungated: MemberReader,
  audit?: MemberReaderAudit,
): MemberReader {
  const gated: MemberReader = async (userId, qn, payload) => {
    if (!allowSystemIdentity) throw systemIdentitySwitchDenied(callerLabel);
    if (audit?.reason !== undefined) {
      audit.report("identity-switch", audit.reason, { id: userId, tenantId: audit.tenantId });
    }
    return ungated(userId, qn, payload);
  };
  ungatedMemberReaderByGated.set(gated, { ungated, audit });
  return gated;
}

type GatedProjectionReaderSource = {
  readonly ungated: ProjectionReader;
  readonly report?: EscapeHatchReporter;
};

// Same idea, for ctx.queryProjection — a single function rather than a pair.
const ungatedProjectionReaderByGated = new WeakMap<ProjectionReader, GatedProjectionReaderSource>();

// ctx.queryProjection's gate: only { unsafeAllTenants: true } is grant-checked —
// a plain call always passes through, tenant-scoped by the projection's own table.
export function createGatedProjectionReader(
  callerLabel: string,
  hasGrant: boolean,
  ungated: ProjectionReader,
  audit?: IdentitySwitchAudit,
): ProjectionReader {
  const gated = async <T = Record<string, unknown>>(
    qualifiedName: string,
    options?: { readonly unsafeAllTenants?: boolean },
  ): Promise<readonly T[]> => {
    if (options?.unsafeAllTenants === true) {
      if (!hasGrant) throw unsafeAllTenantsDenied(callerLabel);
      if (audit?.reason !== undefined) {
        audit.report("unsafe-all-tenants", audit.reason);
      }
    }
    return ungated<T>(qualifiedName, options);
  };
  ungatedProjectionReaderByGated.set(gated, { ungated, report: audit?.report });
  return gated;
}

function readIdentitySwitchFn<
  TFn extends QueryAsFn | WriteAsFn | ResolveActiveMembershipFn | MemberReader | ProjectionReader,
>(
  context: object,
  key: "queryAs" | "writeAs" | "resolveActiveMembership" | "queryAsMember" | "queryProjection",
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

// Only a dispatcher-registered gate names the caller; ctx.user is never trusted, and two
// gates for different callers (a hand-mixed ctx) yield none, so only a grant passes.
function resolveDispatcherCaller(
  querySource: GatedIdentitySwitchSource | undefined,
  writeSource: GatedIdentitySwitchSource | undefined,
): SessionUser | undefined {
  if (querySource && writeSource && querySource.caller !== writeSource.caller) return undefined;
  return (querySource ?? writeSource)?.caller;
}

// Resolved per function: a shared ungated pair would revive a member-resolution
// ctx's deny-stubbed writeAs through its still-registered queryAs.
function gatedIdentitySwitchFields(
  callerLabel: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
  ctxQueryAs: QueryAsFn | undefined,
  ctxWriteAs: WriteAsFn | undefined,
): Partial<IdentitySwitch> {
  if (!ctxQueryAs && !ctxWriteAs) return {};
  const querySource = ctxQueryAs && sourceByGated.get(ctxQueryAs);
  const writeSource = ctxWriteAs && sourceByGated.get(ctxWriteAs);
  const ungatedQueryAs = ctxQueryAs && (querySource?.ungated.queryAs ?? ctxQueryAs);
  const ungatedWriteAs = ctxWriteAs && (writeSource?.ungated.writeAs ?? ctxWriteAs);
  const ungated = fallbackUngatedIdentitySwitch(callerLabel, ungatedQueryAs, ungatedWriteAs);
  const caller = resolveDispatcherCaller(querySource, writeSource);
  const report = (querySource ?? writeSource)?.report;
  const audit = report ? { reason: escapeHatch?.reason, report } : undefined;
  const gated = createGatedIdentitySwitch(
    callerLabel,
    caller,
    escapeHatch !== undefined,
    ungated,
    audit,
  );
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
  const source = ungatedMemberReaderByGated.get(ctxQueryAsMember);
  const ungated = source?.ungated ?? ctxQueryAsMember;
  const audit = source?.audit
    ? { reason: escapeHatch?.reason, report: source.audit.report, tenantId: source.audit.tenantId }
    : undefined;
  return {
    queryAsMember: createGatedMemberReader(callerLabel, escapeHatch !== undefined, ungated, audit),
  };
}

// Re-gates ctx.queryProjection under the hook's own escapeHatch, same
// re-gating rule as the other fields below — see withHookEscapeHatchGrant.
function gatedProjectionReaderField(
  callerLabel: string,
  escapeHatch: EscapeHatchDeclaration | undefined,
  ctxQueryProjection: ProjectionReader | undefined,
): { queryProjection?: ProjectionReader } {
  if (!ctxQueryProjection) return {};
  const source = ungatedProjectionReaderByGated.get(ctxQueryProjection);
  const ungated = source?.ungated ?? ctxQueryProjection;
  const audit = source?.report ? { reason: escapeHatch?.reason, report: source.report } : undefined;
  return {
    queryProjection: createGatedProjectionReader(
      callerLabel,
      escapeHatch !== undefined,
      ungated,
      audit,
    ),
  };
}

export function withHookEscapeHatchGrant<TContext extends object>(
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
  const ctxQueryProjection = readIdentitySwitchFn<ProjectionReader>(context, "queryProjection");
  const ctxDb = readDbLikeValue(context, "db");
  const ctxDbOutsideTransaction = readDbLikeValue(context, "dbOutsideTransaction");
  if (
    !ctxQueryAs &&
    !ctxWriteAs &&
    !ctxResolveActiveMembership &&
    !ctxQueryAsMember &&
    !ctxQueryProjection &&
    !ctxDb &&
    !ctxDbOutsideTransaction
  ) {
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
    ...gatedProjectionReaderField(callerLabel, escapeHatch, ctxQueryProjection),
    // @cast-boundary engine-bridge — withUnsafeRawGrant passes non-TenantDb values (e.g. a guard Proxy) through unchanged.
    ...(ctxDb && { db: withUnsafeRawGrant(ctxDb as TenantDb, escapeHatch) }),
    ...(ctxDbOutsideTransaction && {
      dbOutsideTransaction: withUnsafeRawGrant(ctxDbOutsideTransaction as TenantDb, escapeHatch),
    }),
  };
}

// Re-gates a hook's own ctx.queryAs/ctx.writeAs/ctx.queryProjection/ctx.db/ctx.dbOutsideTransaction instead of inheriting the handler's grant.
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
