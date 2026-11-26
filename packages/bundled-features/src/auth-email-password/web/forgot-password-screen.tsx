// ForgotPasswordScreen — form with an email input. Submission triggers
// /api/auth/request-password-reset (silent success, no account enumeration).
// The UI always shows a "If an account exists, the email is on its way"
// confirmation, even when the server determines internally that the email
// does not exist.
//
// The app is responsible for mounting and exposing the screen at a URL
// (for example, /forgot-password); the LoginScreen can link to that app
// route with a "Forgot password?" link.

import type { ReactNode } from "react";
import { requestPasswordReset } from "./auth-client.ts";
import { resolveReturnTo } from "./auth-redirect.ts";
import { EmailRequestScreen } from "./email-request-screen.tsx";

export type ForgotPasswordScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href for the "Back to login" link in the success and form states. App-
   * specific — defaults to "/login". */
  readonly loginHref?: string;
  /** Page the reset mail should lead back to after the new password is set; defaults to the
   *  `returnTo` query parameter of this page. Unsafe values are dropped. */
  readonly returnTo?: string;
};

export function ForgotPasswordScreen({
  title,
  subtitle,
  loginHref = "/login",
  returnTo,
}: ForgotPasswordScreenProps): ReactNode {
  return (
    <EmailRequestScreen
      title={title}
      subtitle={subtitle}
      loginHref={loginHref}
      fieldId="forgot-email"
      textKeys={{
        title: "auth.forgotPassword.title",
        intro: "auth.forgotPassword.intro",
        email: "auth.forgotPassword.email",
        submit: "auth.forgotPassword.submit",
        submitting: "auth.forgotPassword.submitting",
        successTitle: "auth.forgotPassword.successTitle",
        successBody: "auth.forgotPassword.successBody",
        backToLogin: "auth.forgotPassword.backToLogin",
        rateLimitedWithMinutes: "auth.errors.accountLockedRetry",
      }}
      submitEmail={(email) => requestPasswordReset(email, resolveReturnTo(returnTo))}
    />
  );
}
