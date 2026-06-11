// @runtime client
// Reine String-Konstanten — client-markiert, damit der ProfileScreen
// (web/) sie importieren darf; runtime-Code (handlers/feature) darf
// client-Dateien ohnehin ziehen.

export const USER_PROFILE_FEATURE = "user-profile" as const;

export const UserProfileHandlers = {
  changeEmail: "user-profile:write:change-email",
} as const;

// Fremde QNs die der ProfileScreen dispatcht, hier gepinnt statt als
// Magic-Strings im Screen (und statt runtime-Barrel-Imports, die die
// Runtime-Isolation verletzen würden). Drift-Schutz: der Integration-
// Test vergleicht sie gegen die Original-Konstanten der Features.
export const UserProfileQueries = {
  me: "user:query:user:me",
} as const;

export const UserDataRightsHandlers = {
  requestDeletion: "user-data-rights:write:request-deletion",
  cancelDeletion: "user-data-rights:write:cancel-deletion",
} as const;

export const UserProfileErrors = {
  emailUnchanged: "email_unchanged",
} as const;
