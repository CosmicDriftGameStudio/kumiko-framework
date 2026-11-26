// RequestAccountUnlockScreen — form with an email input. Submit triggers
// /api/auth/request-account-unlock (silent-success, no account
// enumeration). UI unconditionally shows an "if your account is locked,
// a mail is on its way" confirmation — even when the server internally
// knows the email doesn't exist or isn't locked. Mirrors
// ForgotPasswordScreen 1:1.
//
// The app is responsible for mounting this screen under a URL (e.g.
// /unlock-account) and for reaching it — LoginScreen can render a link
// to the app route on accountLocked errors.

import type { ReactNode } from "react";
import { requestAccountUnlock } from "./auth-client.ts";
import { EmailRequestScreen } from "./email-request-screen.tsx";

export type RequestAccountUnlockScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href for the "back to sign in" link in success + form state. App-
   *  specific — default "/login". */
  readonly loginHref?: string;
};

export function RequestAccountUnlockScreen({
  title,
  subtitle,
  loginHref = "/login",
}: RequestAccountUnlockScreenProps): ReactNode {
  return (
    <EmailRequestScreen
      title={title}
      subtitle={subtitle}
      loginHref={loginHref}
      fieldId="unlock-email"
      textKeys={{
        title: "auth.requestUnlock.title",
        intro: "auth.requestUnlock.intro",
        email: "auth.requestUnlock.email",
        submit: "auth.requestUnlock.submit",
        submitting: "auth.requestUnlock.submitting",
        successTitle: "auth.requestUnlock.successTitle",
        successBody: "auth.requestUnlock.successBody",
        backToLogin: "auth.requestUnlock.backToLogin",
        rateLimitedWithMinutes: "auth.requestUnlock.rateLimited",
      }}
      submitEmail={requestAccountUnlock}
    />
  );
}
