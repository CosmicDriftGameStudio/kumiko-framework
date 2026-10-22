import * as z from "zod";
import { createAnonymousUser } from "../engine/system-user.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { Routes } from "./api-constants.ts";
import type { AuthRouteContext } from "./auth-routes-context.ts";
import type { PendingMfaStep, PublicAuthErrorStatus } from "./auth-routes-shared.ts";
import {
  pendingMfaStepResponse,
  registerTokenRequestRoute,
  SignupRequestBody,
} from "./auth-routes-shared.ts";

const SignupConfirmBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

type SignupOutcome = {
  readonly roles: readonly string[];
  readonly tenantId: string;
  readonly tenantKey: string;
  readonly handover?: { readonly entityType: string; readonly id: string };
};

export function registerSignupRoutes(ctx: AuthRouteContext): void {
  const { api, dispatcher, config, mintSessionAndRespond, landingPathFragment } = ctx;
  // Signup confirm mints the session (auto-login) unless the MFA gate applies;
  // then it answers with the MFA step only, no session or cookies.
  if (config.signup) {
    const sg = config.signup;
    registerTokenRequestRoute({
      api,
      dispatcher,
      path: Routes.authSignupRequest,
      requestHandler: sg.requestHandler,
      schema: SignupRequestBody,
    });

    api.post(Routes.authSignupConfirm, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = SignupConfirmBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }

      const result = await dispatcher.write(
        sg.confirmHandler,
        parsed.data,
        createAnonymousUser(SYSTEM_TENANT_ID),
      );

      if (!result.isSuccess) {
        // 422 for invalid_signup_token (handler-level UnprocessableError).
        // @cast-boundary engine-payload — KumikoError.httpStatus narrows to the http-status union
        const status = result.error.httpStatus as PublicAuthErrorStatus;
        return c.json({ isSuccess: false, error: result.error }, status);
      }

      // @cast-boundary engine-payload — generic dispatcher.write result for signup-confirm
      const data = result.data as
        | ({ kind: "auth-session"; session: SessionUser } & Pick<
            SignupOutcome,
            "tenantKey" | "handover"
          >)
        | (PendingMfaStep & { signup: SignupOutcome });

      if (data.kind !== "auth-session") {
        // No session yet, but the account and a claimed handover exist: hand
        // the signup landing to the client so the login that follows lands
        // where a signup without the MFA gate would have.
        return pendingMfaStepResponse(
          c,
          data,
          landingPathFragment({ flow: "signup", ...data.signup }),
        );
      }

      // Session creation + JWT sign + cookies — see mintSessionAndRespond.
      const token = await mintSessionAndRespond(c, data.session);
      const signupOutcome: SignupOutcome = {
        roles: data.session.roles,
        tenantId: data.session.tenantId,
        tenantKey: data.tenantKey,
        ...(data.handover !== undefined && { handover: data.handover }),
      };
      const landingPath = landingPathFragment({ flow: "signup", ...signupOutcome });

      return c.json({
        isSuccess: true,
        token,
        user: {
          id: data.session.id,
          tenantId: data.session.tenantId,
          roles: data.session.roles,
        },
        // tenantKey for the post-signup redirect to /<tenantKey>/. Unlike the
        // login response, which only needs `tenants[]` (the user picks in the
        // switcher), signup knows exactly ONE membership — the frontend UI uses
        // it directly as the redirect target.
        tenantKey: data.tenantKey,
        // Cross-device try-first handover:
        // present only when signup-confirm actually claimed a bound grant —
        // absent, not null, so a client that doesn't know the field sees
        // nothing unusual.
        ...(data.handover !== undefined && { handover: data.handover }),
        ...landingPath,
      });
    });
  }
}
