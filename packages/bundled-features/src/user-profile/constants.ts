// @runtime client
// Plain string constants — client-marked so web/profile-screen.tsx can
// import them; runtime code (handlers/feature) may pull client files anyway.

export const USER_PROFILE_FEATURE = "user-profile" as const;

export const PROFILE_SCREEN_ID = "profile" as const;

// EditExtensionSection `__component` markers (fw#2312) — change-password and
// change-email stay React components (re-auth flows a declarative action
// can't express); deletion moved to declarative fields/actions on the screen
// itself (feature.ts), same split as user-data-rights' privacy-center.
export const CHANGE_EMAIL_SECTION_EXTENSION_NAME = "UserProfileChangeEmailSection" as const;
export const CHANGE_PASSWORD_SECTION_EXTENSION_NAME = "UserProfileChangePasswordSection" as const;

export const UserProfileHandlers = {
  changeEmail: "user-profile:write:change-email",
} as const;

// Foreign QNs the profile screen dispatches, pinned here instead of as
// magic strings in the screen (and instead of runtime-barrel imports, which
// would violate runtime isolation). Drift guard: the integration test
// compares these against the owning features' original constants.
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
