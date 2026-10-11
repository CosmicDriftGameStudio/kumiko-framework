export type Chrome = {
  imageMissing: string;
  textMissing: string;
  textMissingBody: string;
  textStale: string;
  staleBody: string;
  textFallbackNotice: (fallbackLocale: string) => string;
  shotsFallbackNotice: (shotsLocale: string) => string;
  chapters: string;
  overview: string;
  planned: string;
  plannedShort: string;
  staleShort: string;
  plannedIntro: string;
  plannedNone: string;
  plannedColumns: [string, string, string];
  appendix: string;
  language: string;
  size: string;
  hint: string;
  lightbox: string;
  close: string;
  fallbackGroup: string;
  builtAt: string;
  viewports: { desktop: string; tablet: string; mobile: string; all: string };
};

const de: Chrome = {
  imageMissing: "Bild fehlt",
  textMissing: "Text fehlt",
  textMissingBody: "Für dieses Kapitel gibt es noch keinen Text.",
  textStale: "Text veraltet?",
  staleBody: "Diese fett gesetzten Begriffe stehen nicht in den Oberflächentexten:",
  textFallbackNotice: (locale) => `Text in dieser Sprache fehlt, angezeigt wird ${locale}.`,
  shotsFallbackNotice: (locale) => `Screenshots nur in ${locale} vorhanden.`,
  chapters: "Kapitel",
  overview: "Übersicht",
  planned: "Geplante Masken",
  plannedShort: "geplant",
  staleShort: "veraltet?",
  plannedIntro: "Diese Masken stehen in der Screen-Liste, haben aber weder Text noch Screenshots.",
  plannedNone: "Alle Masken sind dokumentiert.",
  plannedColumns: ["Maske", "Kennung", "Gruppe"],
  appendix: "Anhang",
  language: "Sprache",
  size: "Größe",
  hint: "↑ ↓ Kapitel · 1 2 3 4 Größe",
  lightbox: "Screenshot vergrößert",
  close: "Schließen",
  fallbackGroup: "Weitere",
  builtAt: "Stand",
  viewports: {
    desktop: "Desktop",
    tablet: "Tablet",
    mobile: "Mobil",
    all: "Alle",
  },
};

const en: Chrome = {
  imageMissing: "Image missing",
  textMissing: "Text missing",
  textMissingBody: "This chapter has no text yet.",
  textStale: "Text outdated?",
  staleBody: "These bold terms do not appear in the UI strings:",
  textFallbackNotice: (locale) => `Text missing in this language, showing ${locale}.`,
  shotsFallbackNotice: (locale) => `Screenshots only available in ${locale}.`,
  chapters: "Chapters",
  overview: "Overview",
  planned: "Planned screens",
  plannedShort: "planned",
  staleShort: "outdated?",
  plannedIntro: "These screens are in the screen list but have neither text nor screenshots.",
  plannedNone: "All screens are documented.",
  plannedColumns: ["Screen", "ID", "Group"],
  appendix: "Appendix",
  language: "Language",
  size: "Size",
  hint: "↑ ↓ Chapter · 1 2 3 4 Size",
  lightbox: "Screenshot enlarged",
  close: "Close",
  fallbackGroup: "Other",
  builtAt: "Built",
  viewports: {
    desktop: "Desktop",
    tablet: "Tablet",
    mobile: "Mobile",
    all: "All",
  },
};

const CHROME: Record<string, Chrome> = { de, en };

export function chromeFor(locale: string): Chrome {
  return CHROME[locale] ?? de;
}
