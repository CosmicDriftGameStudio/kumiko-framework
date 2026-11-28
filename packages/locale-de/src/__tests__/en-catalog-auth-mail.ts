// English copy of the auth-email-password mail texts (subject, body parts per mail kind).

export const authMailEnCatalog: Readonly<Record<string, string>> = {
  "auth.mail.activation.button": "Activate account",
  "auth.mail.activation.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.activation.greeting": "Welcome,",
  "auth.mail.activation.ignore":
    "If you didn't sign up, you can ignore this email — no account is created until you open the link.",
  "auth.mail.activation.intro":
    "click the link below to activate your {app} account. The next step is choosing your password:",
  "auth.mail.activation.subject": "{app} — Activate your account",
  "auth.mail.appNameDefault": "Account",
  "auth.mail.initialPassword.button": "Set password",
  "auth.mail.initialPassword.expiry":
    "The link is valid for {duration} (until {when}). After that, use “Forgot password?” on the sign-in page.",
  "auth.mail.initialPassword.greeting": "Hi,",
  "auth.mail.initialPassword.ignore":
    "If you weren't expecting this account, you can ignore this email.",
  "auth.mail.initialPassword.intro":
    "your {app} account has been created. Click the link below to set your password:",
  "auth.mail.initialPassword.subject": "{app} — Your access: set your password",
  "auth.mail.invite.button": "Accept invitation",
  "auth.mail.invite.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.invite.greeting": "Hi,",
  "auth.mail.invite.ignore": "If you weren't expecting this invitation, you can ignore this email.",
  "auth.mail.invite.intro":
    "you've been invited to a {app} workspace as {role}. Click the link below to accept:",
  "auth.mail.invite.subject": "{app} — Workspace invitation",
  "auth.mail.reset.button": "Reset password",
  "auth.mail.reset.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.reset.greeting": "Hi,",
  "auth.mail.reset.ignore":
    "If you didn't request a reset, you can safely ignore this email — your password won't change.",
  "auth.mail.reset.intro":
    "you requested a password reset for {app}. Click the link below to set a new password:",
  "auth.mail.reset.subject": "{app} — Reset your password",
  "auth.mail.unlock.button": "Unlock account",
  "auth.mail.unlock.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.unlock.greeting": "Hi,",
  "auth.mail.unlock.ignore":
    "If you didn't trigger this lock, you can ignore this email — the lock expires on its own.",
  "auth.mail.unlock.intro":
    "your {app} account was temporarily locked after several failed sign-in attempts. Click the link below to unlock it immediately:",
  "auth.mail.unlock.subject": "{app} — Unlock your account",
  "auth.mail.verify.button": "Verify email",
  "auth.mail.verify.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.verify.greeting": "Welcome,",
  "auth.mail.verify.ignore": "If you didn't create this account, you can ignore this email.",
  "auth.mail.verify.intro": "please verify your email address for {app} to activate your account:",
  "auth.mail.verify.subject": "{app} — Verify your email",
};
