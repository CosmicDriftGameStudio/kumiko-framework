// App-side screen placement. Most bundled features self-register their screens
// (tenant-list, user-list, tier-admin, privacy-center, page-list). user-profile
// is the exception: it ships the ProfileScreen component + change-email handler
// but leaves screen registration to the app (so nav + access stay app-owned).
// Here we declare the custom "profile" screen; client.tsx wires the component.
// `nav` places it as createKumikoApp's landing fallback (#1258): an open
// screen not reachable via nav is no longer an eligible fallback candidate.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export const appScreensFeature: FeatureDefinition = defineFeature("app-screens", (r) => {
  r.describe("App-side screen placement for the user-profile self-service page.");
  r.requires("user-profile");
  r.screen({
    id: "profile",
    type: "custom",
    renderer: { react: { __component: "UserProfileScreen" } },
    nav: { label: "screen:profile.title" },
  });
  r.translations({
    keys: { "screen:profile.title": { de: "Profil", en: "Profile" } },
  });
  return {};
});
