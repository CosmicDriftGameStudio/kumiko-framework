// @runtime client
// Handlers for RowAction `kind: "clientAction"`: an admin screen lists users and
// triggers the same public mail flows the login screens use.

import type { ClientActionHandler, ClientActionOutcome } from "@cosmicdrift/kumiko-renderer";
import {
  type AuthTokenFailure,
  requestEmailVerification,
  requestPasswordReset,
} from "./auth-client.ts";

type EmailFlow = (
  email: string,
) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: AuthTokenFailure }>;

function failureMessageKey(failure: AuthTokenFailure): string {
  return failure.reason === "rate_limited" ? "auth.errors.rateLimited" : "auth.errors.unknownError";
}

function emailFlowHandler(flow: EmailFlow): ClientActionHandler {
  return async (payload): Promise<ClientActionOutcome> => {
    const email = payload["email"];
    if (typeof email !== "string" || email === "") {
      return { ok: false, message: "auth.errors.invalidBody" };
    }
    const result = await flow(email);
    return result.ok ? { ok: true } : { ok: false, message: failureMessageKey(result.error) };
  };
}

export const emailPasswordClientActions: Readonly<Record<string, ClientActionHandler>> = {
  "auth-email-password:request-password-reset": emailFlowHandler(requestPasswordReset),
  "auth-email-password:request-email-verification": emailFlowHandler(requestEmailVerification),
};
