// Browser-Entry für den Screenshot-Render-Pfad. Registriert die ClientFeatures
// der bundled-features, die einen eigenen /web-Renderer haben. Entity-backed
// Screens (tenant-list, user-list, page-list) rendern generisch ohne Plugin;
// privacy-center + tier-admin liefern ihre Komponente über das jeweilige
// Client-Plugin. user-profile liefert NUR Translations — die ProfileScreen-
// Komponente wird hier an die app-registrierte Screen-id "profile" gehängt.
//
// APP_TRANSLATIONS: die entity-backed Admin-Screens (tenant/user/managed-pages)
// haben kein /web-Plugin, das ihre Spalten-Labels mitbrächte. Sie nutzen die
// `<feature>:entity:<e>:field:*`-Convention und überlassen die Labels bewusst
// der App (siehe user/screens.ts). use-all-bundled IST diese App.

import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { personalAccessTokensClient } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens/web";
import { tagsClient } from "@cosmicdrift/kumiko-bundled-features/tags/web";
import { tierEngineClient } from "@cosmicdrift/kumiko-bundled-features/tier-engine/web";
import { userDataRightsClient } from "@cosmicdrift/kumiko-bundled-features/user-data-rights/web";
import {
  ProfileScreen,
  userProfileClient,
} from "@cosmicdrift/kumiko-bundled-features/user-profile/web";
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import { type ClientFeatureDefinition, createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
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
  components: { profile: ProfileScreen },
  translations: APP_TRANSLATIONS,
};

createKumikoApp({
  shell: AppShell,
  clientFeatures: [
    emailPasswordClient(),
    tierEngineClient(),
    userProfileClient(),
    userDataRightsClient(),
    personalAccessTokensClient(),
    // tag-list management screen (TagManager) + TagSection/TagFilter extension
    // slots + tag i18n. Required for the dev-only notesFeature host to render.
    tagsClient(),
    appScreens,
  ],
});
