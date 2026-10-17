// @runtime client
// Server-registered so the document designer names the seeded auth mails.
export const AUTH_EMAIL_PASSWORD_MAIL_I18N: Readonly<Record<string, { readonly en: string }>> = {
  "auth-email-password:feature.label": { en: "Sign-in" },
  "auth-email-password:notify.password-reset.label": { en: "Password reset" },
  "auth-email-password:notify.account-unlock.label": { en: "Account unlock" },
  "auth-email-password:notify.email-verification.label": { en: "Email verification" },
  "auth-email-password:notify.signup-activation.label": { en: "Sign-up activation" },
  "auth-email-password:notify.invite.label": { en: "Invitation" },
};
