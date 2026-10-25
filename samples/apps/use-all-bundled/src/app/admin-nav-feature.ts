import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// Sidebar group for the admin screens. Bundled features have no shared admin group,
// so the app owns it and mounts e.g. readiness's system check below it.
export const ADMIN_NAV_QN = "admin-nav:nav:administration";
// Each nav joins only the workspaces it names, so the group and every child list them.
export const ADMIN_NAV_WORKSPACES = [
  "admin-shell:workspace:tenant-admin",
  "admin-shell:workspace:platform",
] as const;

export const adminNavFeature = defineFeature("admin-nav", (r) => {
  r.describe("Administration group in the sidebar of this sample app.");
  r.nav({
    id: "administration",
    label: "admin-nav:nav.administration",
    icon: "settings",
    order: 80,
    workspaces: ADMIN_NAV_WORKSPACES,
  });
  r.translations({
    keys: {
      "admin-nav:nav.administration": { de: "Verwaltung", en: "Administration" },
    },
  });
  return {};
});
