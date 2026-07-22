import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

// Companion toggle for the auth-email-password self-signup flow. Handler-less
// (like managed-pages-css/css-gate.ts): composing it just registers
// "auth-self-registration" as toggleable (default ON) so an operator can
// flip it at runtime via feature-toggles, without redeploying and without
// making the rest of auth-email-password (login/reset/verify) toggleable.
//
// Deliberately owns NO handlers — the dispatcher's per-feature gate blocks
// every handler belonging to a disabled feature, and a `status` query living
// here would become unreachable exactly when it matters most (disabled).
// The signup-request handler and the `signupRegistrationStatus` query both
// live in auth-email-password itself and read `ctx.hasFeature(...)` against
// this feature name instead — same split as managed-pages/css-gate.ts vs.
// managed-pages' branding query.
export const AUTH_SELF_REGISTRATION_FEATURE = "auth-self-registration";

export function createAuthSelfRegistrationToggleFeature(): FeatureDefinition {
  return defineFeature(AUTH_SELF_REGISTRATION_FEATURE, (r) => {
    r.describe(
      'Runtime on/off switch for the auth-email-password self-signup flow. Handler-less: composing it registers "auth-self-registration" as a toggleable feature (default ON). auth-email-password\'s signup-request handler and its `signupRegistrationStatus` query both read `ctx.hasFeature("auth-self-registration")` — the query stays reachable when the toggle is off (deliberately not gated itself) so the public signup page can hide its own link/form. Only meaningful when `signup` is configured on `createAuthEmailPasswordFeature` — compose alongside it, then flip via the feature-toggles admin screen.',
    );
    r.toggleable({ default: true });
  });
}
