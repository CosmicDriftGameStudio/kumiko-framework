import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { SignatureOptions } from "./options.ts";

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

export function createSubjectScope(
  opts: Pick<SignatureOptions, "authorizeSubject" | "unscopedRoles">,
): SubjectScope {
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
