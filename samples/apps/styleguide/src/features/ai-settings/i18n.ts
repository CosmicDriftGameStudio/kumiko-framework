import type { LocalizedString } from "../shared-i18n";

const FIELD = "ai-settings:entity";

export const AI_SETTINGS_I18N: Readonly<Record<string, LocalizedString>> = {
  "ai-settings:nav.ai": { de: "KI-Einstellungen", en: "AI settings" },
  "ai-settings:nav.connections": { de: "KI-Verbindungen", en: "AI connections" },
  "ai-settings:nav.connectionNew": { de: "Neue Verbindung", en: "New connection" },
  "ai-settings:nav.stepAssign": { de: "KI-Schritt zuordnen", en: "Assign AI step" },

  "ai-settings.settings": { de: "KI-Einstellungen", en: "AI settings" },
  "ai-settings.text-connection": { de: "Verbindung", en: "Connection" },
  "ai-settings.text-model": { de: "Modell", en: "Model" },
  "screen:ai-settings-tenant.title": { de: "Standard-Modelle", en: "Default models" },

  "screen:connection-edit.title": { de: "Verbindung", en: "Connection" },
  "screen:connection-edit.create.title": { de: "Neue Verbindung", en: "New connection" },
  "screen:connection-edit.create.subtitle": {
    de: "Zugang zu einem KI-Anbieter.",
    en: "Access to an AI provider.",
  },
  "screen:connection-edit.edit.title": { de: "Verbindung bearbeiten", en: "Edit connection" },
  "screen:connection-edit.edit.subtitle": {
    de: "Der API-Schlüssel wird nie angezeigt.",
    en: "The API key is never shown.",
  },
  "screen:connection-list.title": { de: "KI-Verbindungen", en: "AI connections" },
  "screen:connection-detail.title": { de: "Verbindung", en: "Connection" },
  "screen:step-assign.title": { de: "KI-Schritt zuordnen", en: "Assign AI step" },
  "ai-settings.section.connection": { de: "Verbindung", en: "Connection" },
  "ai-settings.section.step": { de: "1 KI-Schritt wählen", en: "1 Choose AI step" },
  "ai-settings.section.model": { de: "2 Modell festlegen", en: "2 Choose model" },
  "ai-settings.tab.overview": { de: "Überblick", en: "Overview" },
  "ai-settings.tab.probe": { de: "Probelauf", en: "Trial run" },
  "ai-settings.action.edit": { de: "Bearbeiten", en: "Edit" },
  "ai-settings.action.probe": { de: "Probelauf", en: "Trial run" },
  "ai-settings.action.start-probe": { de: "Probelauf starten", en: "Start trial run" },
  "ai-settings.action.assign": { de: "Zuordnen", en: "Assign" },

  [`${FIELD}:connection:field:name`]: { de: "Name", en: "Name" },
  [`${FIELD}:connection:field:provider`]: { de: "Anbieter", en: "Provider" },
  [`${FIELD}:connection:field:apiKey`]: { de: "API-Schlüssel", en: "API key" },
  [`${FIELD}:connection:field:provider:option:anthropic`]: { de: "Anthropic", en: "Anthropic" },
  [`${FIELD}:connection:field:provider:option:openai`]: { de: "OpenAI", en: "OpenAI" },
  [`${FIELD}:connection:field:provider:option:openrouter`]: {
    de: "OpenRouter",
    en: "OpenRouter",
  },
  [`${FIELD}:__action-form__:field:step`]: { de: "KI-Schritt", en: "AI step" },
  [`${FIELD}:__action-form__:field:connection`]: { de: "Verbindung", en: "Connection" },
  [`${FIELD}:__action-form__:field:model`]: { de: "Modell", en: "Model" },
  [`${FIELD}:__write-form-section__:field:model`]: { de: "Modell", en: "Model" },
  [`${FIELD}:__write-form-section__:field:prompt`]: { de: "Testeingabe", en: "Test input" },
};
