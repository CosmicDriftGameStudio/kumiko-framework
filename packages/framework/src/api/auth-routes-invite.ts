import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as z from "zod";
import { createAnonymousUser } from "../engine/system-user.ts";
import type { SessionUser, TenantId } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { toKumikoError, toWriteErrorInfo } from "../errors/index.ts";
import { Routes } from "./api-constants.ts";
import { getUser } from "./auth-middleware.ts";
import type { AuthRouteContext } from "./auth-routes-context.ts";
import type { PublicAuthErrorStatus } from "./auth-routes-shared.ts";
import { pendingMfaStepResponse } from "./auth-routes-shared.ts";

const InviteAcceptBody = z.object({
  token: z.string().min(1),
});

const InviteAcceptWithLoginBody = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

const InviteSignupCompleteBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

const InviteInfoBody = z.object({
  token: z.string().min(1),
});

export function registerInviteRoutes(ctx: AuthRouteContext): void {
  const { api, dispatcher, config, mintSessionAndRespond, landingPathFragment } = ctx;
  // Tenant-Invite magic link. 3 separate routes for 3 accept branches:
  if (config.invite) {
    const inv = config.invite;

    // Branch 1: a logged-in user clicks the invite link → membership add in
    // the invited tenant (NOT a tenant switch — the user stays in their
    // current session and can switch later via the tenant switcher).
    // Requires JWT (see PUBLIC_API_PATHS — invite-accept is NOT public,
    // unlike acceptWithLogin/signupComplete).
    api.post(Routes.authInviteAccept, async (c) => {
      const user = getUser(c);
      const raw = await c.req.json().catch(() => null);
      const parsed = InviteAcceptBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const result = await dispatcher.write(inv.acceptHandler, parsed.data, user);
      if (!result.isSuccess) {
        // @cast-boundary engine-payload — KumikoError.httpStatus
        const status = result.error.httpStatus as PublicAuthErrorStatus;
        return c.json({ isSuccess: false, error: result.error }, status);
      }
      // @cast-boundary engine-payload — generic dispatcher.write result
      const data = result.data as {
        kind: "invite-accepted";
        tenantId: TenantId;
        role: string;
        alreadyMember: boolean;
      };
      const landingPath = landingPathFragment({
        flow: "invite",
        roles: [data.role],
        tenantId: data.tenantId,
      });
      return c.json({
        isSuccess: true,
        tenantId: data.tenantId,
        role: data.role,
        alreadyMember: data.alreadyMember,
        ...landingPath,
      });
    });

    // Branch 2: anonymous user with an existing email — login + accept in a
    // single round trip. JWT mint analogous to signup-confirm.
    api.post(Routes.authInviteAcceptWithLogin, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = InviteAcceptWithLoginBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const result = await dispatcher.write(
        inv.acceptWithLoginHandler,
        parsed.data,
        createAnonymousUser(SYSTEM_TENANT_ID),
      );
      if (!result.isSuccess) {
        const status = result.error.httpStatus as PublicAuthErrorStatus; // @cast-boundary engine-payload
        return c.json({ isSuccess: false, error: result.error }, status);
      }
      // @cast-boundary engine-payload — same three-shape union as /auth/login
      // (see gateEnforceMfa): a straight session, an MFA challenge, or a
      // hard mfa-setup-required block. Only the auth-session branch also
      // carries tenantId/role (invite-specific).
      const data = result.data as
        | { kind: "auth-session"; session: SessionUser; tenantId: TenantId; role: string }
        | { kind: "mfa-challenge"; challengeToken: string }
        | { kind: "mfa-setup-required"; preauthSetupToken: string };

      if (data.kind === "mfa-setup-required") {
        return c.json({
          isSuccess: true,
          mfaSetupRequired: true,
          preauthSetupToken: data.preauthSetupToken,
        });
      }

      if (data.kind === "mfa-challenge") {
        return c.json({ isSuccess: true, mfaRequired: true, challengeToken: data.challengeToken });
      }

      const token = await mintSessionAndRespond(c, data.session);
      const landingPath = landingPathFragment({
        flow: "invite",
        roles: data.session.roles,
        tenantId: data.tenantId,
      });
      return c.json({
        isSuccess: true,
        token,
        user: {
          id: data.session.id,
          tenantId: data.session.tenantId,
          roles: data.session.roles,
        },
        tenantId: data.tenantId,
        role: data.role,
        ...landingPath,
      });
    });

    // Branch 3: anonymous user with a new email — user + membership are created,
    // NO new tenant. JWT mint.
    api.post(Routes.authInviteSignupComplete, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = InviteSignupCompleteBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const result = await dispatcher.write(
        inv.signupCompleteHandler,
        parsed.data,
        createAnonymousUser(SYSTEM_TENANT_ID),
      );
      if (!result.isSuccess) {
        const status = result.error.httpStatus as PublicAuthErrorStatus; // @cast-boundary engine-payload
        return c.json({ isSuccess: false, error: result.error }, status);
      }
      // @cast-boundary engine-payload — same three-shape union as invite-accept-with-login
      const data = result.data as
        | { kind: "auth-session"; session: SessionUser; tenantId: TenantId; role: string }
        | { kind: "mfa-challenge"; challengeToken: string }
        | { kind: "mfa-setup-required"; preauthSetupToken: string };

      if (data.kind !== "auth-session") return pendingMfaStepResponse(c, data);

      const token = await mintSessionAndRespond(c, data.session);
      const landingPath = landingPathFragment({
        flow: "invite",
        roles: data.session.roles,
        tenantId: data.tenantId,
      });
      return c.json({
        isSuccess: true,
        token,
        user: {
          id: data.session.id,
          tenantId: data.session.tenantId,
          roles: data.session.roles,
        },
        tenantId: data.tenantId,
        role: data.role,
        ...landingPath,
      });
    });

    // Anonymous, read-only invite lookup for the acceptance page: pre-fill
    // the invited email and pick Branch 2 (existing account) vs Branch 3
    // (new account) before the user submits. Token is never consumed here.
    if (inv.infoHandler) {
      const infoHandler = inv.infoHandler;
      api.post(Routes.authInviteInfo, async (c) => {
        const raw = await c.req.json().catch(() => null);
        const parsed = InviteInfoBody.safeParse(raw);
        if (!parsed.success) {
          return c.json({ isSuccess: false, error: "invalid_body" }, 400);
        }
        try {
          // @cast-boundary engine-payload — generic dispatcher.query result
          const data = (await dispatcher.query(
            infoHandler,
            parsed.data,
            createAnonymousUser(SYSTEM_TENANT_ID),
          )) as { email: string; hasAccount: boolean };
          return c.json({ isSuccess: true, ...data });
        } catch (e) {
          const err = toKumikoError(e);
          // Same body shape as the write routes' `{ isSuccess: false, error:
          // result.error }` (WriteErrorInfo) — this is a query, not a write,
          // so there's no WriteResult to read `.error` off; toWriteErrorInfo
          // builds the equivalent shape directly from the caught error.
          return c.json(
            { isSuccess: false, error: toWriteErrorInfo(err) },
            err.httpStatus as ContentfulStatusCode, // @cast-boundary engine-payload
          );
        }
      });
    }
  }
}
