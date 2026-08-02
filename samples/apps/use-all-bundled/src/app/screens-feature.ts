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
  // Provider node for template-resolver's text-block tree. The app owns
  // label/icon/access, the feature supplies the children plus the editor
  // (textBlocksClient in client.tsx).
  r.nav({
    id: "content",
    label: "nav:content.title",
    icon: "file",
    provider: true,
    order: 40,
    access: { roles: ["SystemAdmin"] },
    workspaces: ["admin-shell:workspace:platform"],
  });
  r.translations({
    keys: {
      "screen:profile.title": { de: "Profil", en: "Profile" },
      "nav:content.title": { de: "Inhalte", en: "Content" },
    },
  });
  return {};
});
