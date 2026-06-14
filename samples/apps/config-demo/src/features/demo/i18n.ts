import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

// Only the app's OWN labels: the per-feature group key `<feature>.settings`
// (child nav + section title) and one mask.title per config key. The generic
// audience labels (config.settings.*) ship with configClient().
export const configDemoTranslations: TranslationsByLocale = {
  de: {
    "config-demo.settings": "Config Demo",
    "config-demo.site-name": "Webseiten-Name",
    "config-demo.theme-color": "Design-Farbe",
    "config-demo.max-upload-size": "Max. Upload-Größe (MB)",
    "config-demo.email-notifications": "E-Mail-Benachrichtigungen",
    "config-demo.auto-approve": "Bestellungen automatisch freigeben",
  },
  en: {
    "config-demo.settings": "Config Demo",
    "config-demo.site-name": "Site Name",
    "config-demo.theme-color": "Theme Color",
    "config-demo.max-upload-size": "Max Upload Size (MB)",
    "config-demo.email-notifications": "Email Notifications",
    "config-demo.auto-approve": "Auto-Approve Orders",
  },
};
