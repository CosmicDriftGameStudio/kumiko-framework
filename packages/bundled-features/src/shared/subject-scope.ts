import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";

export type SubjectScopeOptions = {
  /** Runs for every signed-in handler and query on a subject, except for `unscopedRoles`. `false` answers like "does not exist". */
  readonly authorizeSubject?: (
    ctx: HandlerContext,
    user: SessionUser,
    subject: { readonly subjectType: string; readonly subjectId: string },
  ) => Promise<boolean>;
  /** Roles that skip `authorizeSubject`, e.g. admins. */
  readonly unscopedRoles?: readonly string[];
};

export type SubjectScope = {
  isScoped(user: SessionUser): boolean;
  allows(
    ctx: HandlerContext,
    user: SessionUser,
    subjectType: unknown,
    subjectId: unknown,
  ): Promise<boolean>;
  allowsRequest(
    ctx: HandlerContext,
    user: SessionUser,
    request: { readonly subjectType?: unknown; readonly subjectId?: unknown },
  ): Promise<boolean>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function createSubjectScope(opts: SubjectScopeOptions): SubjectScope {
  const { authorizeSubject } = opts;
  const unscopedRoles = opts.unscopedRoles ?? [];
  const isScoped = (user: SessionUser): boolean =>
    authorizeSubject !== undefined && !user.roles.some((role) => unscopedRoles.includes(role));

  const allows: SubjectScope["allows"] = async (ctx, user, subjectType, subjectId) => {
    if (authorizeSubject === undefined || !isScoped(user)) return true;
    if (!isNonEmptyString(subjectType) || !isNonEmptyString(subjectId)) return false;
    return authorizeSubject(ctx, user, { subjectType, subjectId });
  };

  return {
    isScoped,
    allows,
    allowsRequest: (ctx, user, request) =>
      allows(ctx, user, request.subjectType, request.subjectId),
  };
}
