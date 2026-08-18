type LocalizedString = { readonly de: string; readonly en: string };

export const CAP_COUNTER_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:cap-list.title": { de: "Nutzungslimits", en: "Usage caps" },
  "cap-counter:entity:cap-counter:field:capName": { de: "Limit", en: "Cap" },
  "cap-counter:entity:cap-counter:field:value": { de: "Wert", en: "Value" },
  "cap-counter:entity:cap-counter:field:periodStart": { de: "Periodenstart", en: "Period start" },
  "cap-counter:entity:cap-counter:field:lastSoftWarnedAt": {
    de: "Letzte Soft-Warnung",
    en: "Last soft warning",
  },
};
