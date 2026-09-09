// user-profile Recipe — shows the app-side wiring for the self-service
// account page: the bundled feature ships the screen itself (fw#2312:
// declarative `projectionDetail`, id "profile") including handler + i18n;
// the app only has to navigate to it, no own `r.screen()` registration
// anymore (unlike before #2312 — see user-data-rights' recipe/demo pattern:
// `r.nav({ screen: "<feature>:screen:<id>", ... })`).
//
// Client-side, the app only registers the two extension-section components
// (change-password/change-email stay React, re-auth):
//   import { userProfileClient } from
//     "@cosmicdrift/kumiko-bundled-features/user-profile/web";
//   createKumikoApp({
//     clientFeatures: [emailPasswordClient(), userProfileClient()],
//   })

import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { createUserProfileFeature } from "@cosmicdrift/kumiko-bundled-features/user-profile";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export function createAccountFeature(): FeatureDefinition {
  return defineFeature("account", (r) => {
    r.describe(
      "App-side wiring for the user-profile bundled feature: just the nav " +
        "entry — user-profile registers the `profile` screen itself " +
        "(fw#2312 declarative projectionDetail).",
    );
    r.requires("user-profile");

    r.nav({
      id: "profile",
      label: "account:nav.profile",
      icon: "user",
      screen: "user-profile:screen:profile",
      order: 90,
    });

    return {};
  });
}

/** Volle Feature-Komposition inkl. der user-profile-Require-Kette
 *  (user-data-rights → data-retention + compliance-profiles + sessions). */
export function composeAccountApp(): FeatureDefinition[] {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthEmailPasswordFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    authFoundationFeature,
    createPersonalAccessTokensFeature({ scopes: {} }),
    createSessionsFeature(),
    createFilesFeature(),
    createUserDataRightsFeature(),
    // registers the default export/erase hooks for core PII entities (user,
    // fileRef, folder) so the GDPR boot gate (V3) is satisfied for the stack.
    createUserDataRightsDefaultsFeature(),
    createUserProfileFeature(),
    createAccountFeature(),
  ];
}
