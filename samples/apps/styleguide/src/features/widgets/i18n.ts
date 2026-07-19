// Widgets-Feature i18n-Bundle. Key-first (server r.translations() shape) —
// web/index.ts pivots this into the client TranslationsByLocale shape.

export const WIDGETS_I18N = {
  "screen:widgets.title": { de: "Widgets", en: "Widgets" },
  "screen:widgets-dashboard.title": {
    de: "Dashboard (deklarativ)",
    en: "Dashboard (declarative)",
  },
  "widgets:dashboard:portfolio": { de: "Portfolio", en: "Portfolio" },
  "widgets:dashboard:net-worth": { de: "Netto-Vermögen", en: "Net worth" },
  "widgets:dashboard:net-worth-assets": { de: "Vermögen", en: "Assets" },
  "widgets:dashboard:net-worth-debts": { de: "Schulden", en: "Debts" },
  "widgets:dashboard:response-times": { de: "Antwortzeit", en: "Response time" },
  "widgets:dashboard:latest": { de: "Neueste Ereignisse", en: "Latest events" },
  "widgets:dashboard:col-name": { de: "Name", en: "Name" },
  "widgets:dashboard:col-status": { de: "Status", en: "Status" },
  "widgets:dashboard:upcoming": { de: "Nächste Termine", en: "Upcoming" },
  "widgets:dashboard:goal-progress": { de: "Tilgungsfortschritt", en: "Payoff progress" },
  "widgets:dashboard:filter-region": { de: "Region", en: "Region" },
  "widgets:dashboard:filter-region-eu": { de: "Europa", en: "Europe" },
  "widgets:dashboard:filter-region-us": { de: "USA", en: "USA" },
} as const;
