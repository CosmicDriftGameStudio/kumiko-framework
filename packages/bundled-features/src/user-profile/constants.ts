export const USER_PROFILE_FEATURE = "user-profile" as const;

export const UserProfileHandlers = {
  changeEmail: "user-profile:write:change-email",
} as const;

// QNs der user-data-rights-Handler die der ProfileScreen für die
// Danger-Zone dispatcht. user-data-rights exportiert selbst keine
// Handler-Konstanten — hier gepinnt statt Magic-Strings im Screen.
export const UserDataRightsHandlers = {
  requestDeletion: "user-data-rights:write:request-deletion",
  cancelDeletion: "user-data-rights:write:cancel-deletion",
} as const;

export const UserProfileErrors = {
  emailUnchanged: "email_unchanged",
} as const;
