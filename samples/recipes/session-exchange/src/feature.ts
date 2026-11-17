// Session Exchange Sample
//
// An app-defined login method: an anonymous write handler verifies an identity
// and returns { kind: "auth-session", session }; the framework route mints the
// session (token, cookies, rate limit) exactly like /auth/login.
//
// What to copy into your own app:
//
//   auth: {
//     membershipQuery: "tenant:query:memberships",
//     sessionExchangeHandlers: { code: "demo-exchange:write:code" },
//   },
//
// Only handlers listed in sessionExchangeHandlers can cause a session to be
// issued, so a handler that merely returns a session-shaped object elsewhere
// stays harmless. The demo code check stands in for verifying an ID token;
// sessionForVerifiedUser then runs the login gates after the identity proof
// (account status, membership choice, claims).

import { sessionForVerifiedUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

export const DEMO_EXCHANGE_CODE = "246810";
export const DEMO_EXCHANGE_QN = "demo-exchange:write:code";
export const INVALID_CREDENTIALS_REASON = "invalid_credentials";

export const demoExchangeFeature = defineFeature("demo-exchange", (r) => {
  r.requires({ features: ["user", "tenant"] });

  r.writeHandler({
    name: "code",
    schema: z.object({ email: z.email(), code: z.string().min(1) }),
    access: { roles: ["anonymous"] },
    escapeHatch: {
      grants: ["systemIdentity"],
      reason:
        "Unauthenticated exchange has no caller identity yet — sessionForVerifiedUser looks up the user and resolves the membership as SYSTEM before a session exists.",
    },
    // The payload carries a credential (code or ID token) that must never enter an LLM transcript.
    agent: { expose: false },
    handler: async (event, ctx) => {
      if (event.payload.code !== DEMO_EXCHANGE_CODE) {
        return writeFailure(
          new UnprocessableError(INVALID_CREDENTIALS_REASON, {
            i18nKey: "demo-exchange.errors.invalidCredentials",
          }),
        );
      }
      return sessionForVerifiedUser(ctx, { email: event.payload.email });
    },
  });
});
