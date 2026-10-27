// Browser entry for the screenshot render path. Registers the ClientFeatures
// of bundled features that ship their own /web renderer. Entity-backed
// screens (tenant-list, user-list, page-list) render generically without a
// plugin; privacy-center + tier-admin + user-profile (fw#2312) supply their
// components via their own Client-Plugin — the app only adds its own
// APP_TRANSLATIONS overrides here.
//
// APP_TRANSLATIONS: die entity-backed Admin-Screens (tenant/user/managed-pages)
// APP_TRANSLATIONS: the entity-backed admin screens (tenant/user/managed-pages)
// have no /web plugin that would bring their column labels. They use the
// `<feature>:entity:<e>:field:*` convention and deliberately leave the labels
// to the app (see user/screens.ts). use-all-bundled IS that app.
// adminShellClient + tenant/audit/jobs/config: WorkspaceShell needs the
// admin-shell overview components and Settings-Hub i18n; mirror admin-console
// client registration for features that run-config already mounts server-side.

import { adminShellClient } from "@cosmicdrift/kumiko-bundled-features/admin-shell/web";
import { auditClient } from "@cosmicdrift/kumiko-bundled-features/audit/web";
import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { authMfaClient, MfaVerifyScreen } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/web";
import { billingFoundationClient } from "@cosmicdrift/kumiko-bundled-features/billing-foundation/web";
import { capOverviewClient } from "@cosmicdrift/kumiko-bundled-features/cap-overview/web";
import { complianceProfilesClient } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles/web";
import { configClient } from "@cosmicdrift/kumiko-bundled-features/config/web";
import { customFieldsClient } from "@cosmicdrift/kumiko-bundled-features/custom-fields/web";
import { deliveryClient } from "@cosmicdrift/kumiko-bundled-features/delivery/web";
import { featureTogglesClient } from "@cosmicdrift/kumiko-bundled-features/feature-toggles/web";
import { foldersClient } from "@cosmicdrift/kumiko-bundled-features/folders/web";
import { inboundMailFoundationClient } from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation/web";
import { jobsClient } from "@cosmicdrift/kumiko-bundled-features/jobs/web";
import { managedPagesClient } from "@cosmicdrift/kumiko-bundled-features/managed-pages/web";
import { sessionsClient } from "@cosmicdrift/kumiko-bundled-features/sessions/web";
import { tagsClient } from "@cosmicdrift/kumiko-bundled-features/tags/web";
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { tenantClient } from "@cosmicdrift/kumiko-bundled-features/tenant/web";
import { tierEngineClient } from "@cosmicdrift/kumiko-bundled-features/tier-engine/web";
import { userDataRightsClient } from "@cosmicdrift/kumiko-bundled-features/user-data-rights/web";
import { userProfileClient } from "@cosmicdrift/kumiko-bundled-features/user-profile/web";
import { documentDesignerClient } from "@cosmicdrift/kumiko-document-designer/web";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine/types";
import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import { type ClientFeatureDefinition, createKumikoApp } from "@cosmicdrift/kumiko-renderer/web";
import { AppShell } from "./shell";

const APP_TRANSLATIONS: TranslationsByLocale = {
  en: {
    "tenant:entity:tenant:field:key": "Key",
    "tenant:entity:tenant:field:name": "Name",
    "tenant:entity:tenant:field:isEnabled": "Enabled",
    "user:entity:user:field:email": "Email",
    "user:entity:user:field:displayName": "Display name",
    "user:entity:user:field:status": "Status",
    "user:entity:user:field:emailVerified": "Email verified",
    "managed-pages:entity:page:field:slug": "Slug",
    "managed-pages:entity:page:field:lang": "Language",
    "managed-pages:entity:page:field:title": "Title",
    "managed-pages:entity:page:field:published": "Published",
    "managed-pages:actions.edit": "Edit",
    "managed-pages:actions.delete": "Delete",
    "notes-demo:entity:note:field:title": "Title",
    "notes-demo:section.note": "Note",
    "notes-demo:section.tags": "Tags",
    "notes-demo:actions.edit": "Edit",
    "notes-demo:actions.delete": "Delete",
    "notes-demo:confirms.note-delete": "Delete this note?",
    "screen:note-list.title": "Notes",
    "screen:note-edit.title": "Note",
  },
  de: {
    "tenant:entity:tenant:field:key": "Schlüssel",
    "tenant:entity:tenant:field:name": "Name",
    "tenant:entity:tenant:field:isEnabled": "Aktiv",
    "user:entity:user:field:email": "E-Mail",
    "user:entity:user:field:displayName": "Anzeigename",
    "user:entity:user:field:status": "Status",
    "user:entity:user:field:emailVerified": "E-Mail bestätigt",
    "managed-pages:entity:page:field:slug": "Slug",
    "managed-pages:entity:page:field:lang": "Sprache",
    "managed-pages:entity:page:field:title": "Titel",
    "managed-pages:entity:page:field:published": "Veröffentlicht",
    "managed-pages:actions.edit": "Bearbeiten",
    "managed-pages:actions.delete": "Löschen",
    "notes-demo:entity:note:field:title": "Titel",
    "notes-demo:section.note": "Notiz",
    "notes-demo:section.tags": "Tags",
    "notes-demo:actions.edit": "Bearbeiten",
    "notes-demo:actions.delete": "Löschen",
    "notes-demo:confirms.note-delete": "Diese Notiz löschen?",
    "screen:note-list.title": "Notizen",
    "screen:note-edit.title": "Notiz",
  },
};

const appScreens: ClientFeatureDefinition = {
  name: "app-screens",
  translations: APP_TRANSLATIONS,
};

createKumikoApp({
  shell: AppShell,
  clientFeatures: [
    localeDeClient(),
    userDataRightsClient({
      publicDeletion: { requestPath: "/account/delete", confirmPath: "/account/delete/confirm" },
    }),
    emailPasswordClient({ mfaVerifyScreen: MfaVerifyScreen }),
    authMfaClient(),
    adminShellClient(),
    tenantClient(),
    auditClient(),
    sessionsClient(),
    billingFoundationClient(),
    jobsClient(),
    deliveryClient(),
    configClient(),
    tierEngineClient(),
    capOverviewClient(),
    userProfileClient(),
    customFieldsClient(),
    foldersClient(),
    inboundMailFoundationClient(),
    complianceProfilesClient(),
    featureTogglesClient(),
    // tag-list management screen (TagManager) + TagSection/TagFilter extension
    // slots + tag i18n. Required for the dev-only notesFeature host to render.
    tagsClient(),
    // Document editor of the page-edit body section.
    managedPagesClient(),
    // template-resolver text-block tree + editor under the app-owned "content"
    // nav node. Points at SYSTEM_TENANT because that is where the legal and
    // marketing copy is seeded.
    textBlocksClient({ navId: "app-screens:nav:content", tenantId: SYSTEM_TENANT_ID }),
    // PDF template editor with live PDF preview, mounted as the custom screen
    // app-screens declares (no nav entry; opened by URL).
    documentDesignerClient(),
    appScreens,
  ],
});
