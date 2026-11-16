import type { HandlerContext, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { sessionLocaleField } from "./session-locale-field.ts";
import { sessionTimezoneField } from "./session-timezone-field.ts";

export type AuthSessionInput = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly roles: SessionUser["roles"];
  readonly timezone?: string | null | undefined;
  readonly locale?: string | null | undefined;
};

// Every login-completing handler mints here, so the locale check and the
// auth-claims hooks apply to all of them alike.
export async function mintAuthSession(
  ctx: HandlerContext,
  input: AuthSessionInput,
): Promise<SessionUser> {
  const baseSession: SessionUser = {
    id: input.userId,
    tenantId: input.tenantId,
    roles: input.roles,
    ...sessionTimezoneField(input.timezone),
    ...sessionLocaleField(input.locale),
  };
  const claims = await ctx.auth.resolveClaims(baseSession);
  return Object.keys(claims).length > 0 ? { ...baseSession, claims } : baseSession;
}
