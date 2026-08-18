type LocalizedString = { readonly en: string };

export const CAP_COUNTER_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:cap-list.title": { en: "Usage caps" },
  "cap-counter:entity:cap-counter:field:capName": { en: "Cap" },
  "cap-counter:entity:cap-counter:field:value": { en: "Value" },
  "cap-counter:entity:cap-counter:field:periodStart": { en: "Period start" },
  "cap-counter:entity:cap-counter:field:lastSoftWarnedAt": {
    en: "Last soft warning",
  },
};
