import type { TranslationKeys } from "../engine/types/config.js";

/**
 * Settings-Hub chrome keys (parent-nav labels, secrets-screen title/strings)
 * needed by ANY app that mounts a foundation feature producing a hub nav —
 * `secrets` is auto-mounted (see FOUNDATION_FEATURES in
 * @cosmicdrift/kumiko-dev-server scaffold-app.ts) while `config` stays
 * optional, so these keys must be shippable without `config` present.
 * Both `config` and `secrets` ship this bundle via r.translations — see
 * @cosmicdrift/kumiko-bundled-features config/i18n.ts (CONFIG_FEATURE_I18N)
 * and secrets/feature.ts. Owned here (not in bundled-features) because the
 * Settings-Hub generator that requires these keys
 * (build-config-feature-schema.ts) lives in this package.
 */
export const SETTINGS_HUB_I18N: TranslationKeys = {
  "config.settings.title": { en: "Settings" },
  "config.settings.system": { en: "Platform" },
  "config.settings.tenant": { en: "Tenant" },
  "config.settings.user": { en: "Personal" },
  "config.settings.extensionSelectorHint": {
    en: "Choose a provider and save. Its settings appear below.",
  },
  "config.settings.provider": { en: "Provider" },
  "config.settings.saveProvider": { en: "Save provider" },
  "config.settings.audience.system": {
    en: "Applies to every tenant unless a tenant sets its own value.",
  },
  "config.settings.audience.tenant": {
    en: "Applies to everyone in this tenant. Platform defaults are shown where nothing is set here.",
  },
  "config.settings.audience.user": { en: "Only applies to you." },
  "config.secrets.title": { en: "Secrets" },
  "config.secrets.notSet": { en: "Not set" },
  "config.secrets.set": { en: "Set" },
  "config.secrets.saved": { en: "Saved" },
  "config.secrets.section": { en: "Secrets" },
  "config.secrets.description": {
    en: "Stored encrypted. Saved values are never shown again.",
  },
  "config.secrets.stored": { en: "Stored: {preview}" },
  "config.secrets.placeholder": { en: "Enter a value" },
  "config.secrets.replacePlaceholder": { en: "Enter a new value to replace it" },
  "config.secrets.delete": { en: "Remove" },
  "screen:secrets.title": { en: "Secrets" },
};
