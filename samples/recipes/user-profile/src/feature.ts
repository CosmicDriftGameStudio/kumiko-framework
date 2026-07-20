// user-profile Recipe — zeigt das App-Wiring für die Self-Service-
// Kontoseite: das bundled feature liefert Handler (change-email) +
// ProfileScreen-Komponente + i18n; die App deklariert den Screen als
// `custom` mit der __component-Convention und hängt ihn in die Nav.
//
// Client-seitig registriert die App die Komponente im Renderer-Mount:
//   import { ProfileScreen, userProfileClient } from
//     "@cosmicdrift/kumiko-bundled-features/user-profile/web";
//   createKumikoApp({
//     components: { UserProfileScreen: ProfileScreen },
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
      "App-side wiring for the user-profile bundled feature: declares the " +
        "profile screen (custom renderer, __component UserProfileScreen) and " +
        "its nav entry.",
    );
    r.requires("user-profile");

    r.screen({
      id: "profile",
      type: "custom",
      renderer: { react: { __component: "UserProfileScreen" } },
    });
    r.nav({
      id: "profile",
      label: "account:nav.profile",
      screen: "account:screen:profile",
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
