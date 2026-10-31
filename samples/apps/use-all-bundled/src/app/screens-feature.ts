// App-side screen placement. Bundled features self-register their screens
// (tenant-list, user-list, tier-admin, privacy-center, page-list, and — since
// fw#2312 — user-profile's `profile` screen too). This app only points a nav
// entry at it, which also makes it createKumikoApp's landing fallback
// (#1258): an open screen not reachable via nav is no longer an eligible
// fallback candidate.

import { ContactScreens } from "@cosmicdrift/kumiko-bundled-features/contact";
import { MAIL_ACCOUNT_LIST_SCREEN_QN } from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { ADMIN_NAV_QN, ADMIN_NAV_WORKSPACES } from "./admin-nav-feature";

const PLATFORM_WORKSPACES = ["admin-shell:workspace:platform"] as const;

export const appScreensFeature: FeatureDefinition = defineFeature("app-screens", (r) => {
  r.describe("App-side nav placement for the user-profile self-service page and the mailbox list.");
  r.requires({ features: ["user-profile", "inbound-mail-foundation", "contact"] });
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
  r.nav({
    id: "contact-requests",
    label: "screen:request-list.title",
    icon: "mail",
    screen: ContactScreens.requestList,
    order: 25,
    access: { roles: access.systemAdmin },
    workspaces: PLATFORM_WORKSPACES,
  });
  r.nav({
    id: "contact-forwarding",
    label: "nav:contact-forwarding.title",
    icon: "settings",
    screen: ContactScreens.forwarding,
    parent: ADMIN_NAV_QN,
    order: 30,
    access: { roles: access.systemAdmin },
    workspaces: ADMIN_NAV_WORKSPACES,
  });
  r.nav({
    id: "help",
    label: "nav:help.title",
    icon: "info",
    order: 90,
    workspaces: ADMIN_NAV_WORKSPACES,
  });
  r.nav({
    id: "contact-report",
    label: "screen:report.title",
    icon: "mail",
    screen: ContactScreens.report,
    parent: "app-screens:nav:help",
    order: 10,
    workspaces: ADMIN_NAV_WORKSPACES,
  });
  r.translations({
    keys: {
      "nav:contact-forwarding.title": { de: "Weiterleitung", en: "Forwarding" },
      "nav:help.title": { de: "Hilfe", en: "Help" },
      "nav:mail-accounts.title": { de: "Postfächer", en: "Mailboxes" },
      "screen:profile.title": { de: "Profil", en: "Profile" },
      "nav:content.title": { de: "Inhalte", en: "Content" },
    },
  });
  return {};
});
