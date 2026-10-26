// App-side screen placement. Bundled features self-register their screens
// (tenant-list, user-list, tier-admin, privacy-center, page-list, and — since
// fw#2312 — user-profile's `profile` screen too). This app only points a nav
// entry at it, which also makes it createKumikoApp's landing fallback
// (#1258): an open screen not reachable via nav is no longer an eligible
// fallback candidate.

import { MAIL_ACCOUNT_LIST_SCREEN_QN } from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { ADMIN_NAV_QN, ADMIN_NAV_WORKSPACES } from "./admin-nav-feature";

export const appScreensFeature: FeatureDefinition = defineFeature("app-screens", (r) => {
  r.describe("App-side nav placement for the user-profile self-service page and the mailbox list.");
  r.requires({ features: ["user-profile", "inbound-mail-foundation"] });
  r.nav({
    id: "profile",
    label: "screen:profile.title",
    icon: "user",
    screen: "user-profile:screen:profile",
    order: 10,
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
  r.nav({
    id: "mail-accounts",
    label: "nav:mail-accounts.title",
    icon: "mail",
    screen: MAIL_ACCOUNT_LIST_SCREEN_QN,
    parent: ADMIN_NAV_QN,
    workspaces: ADMIN_NAV_WORKSPACES,
    order: 20,
  });
  r.translations({
    keys: {
      "nav:mail-accounts.title": { de: "Postfächer", en: "Mailboxes" },
      "screen:profile.title": { de: "Profil", en: "Profile" },
      "nav:content.title": { de: "Inhalte", en: "Content" },
    },
  });
  return {};
});
