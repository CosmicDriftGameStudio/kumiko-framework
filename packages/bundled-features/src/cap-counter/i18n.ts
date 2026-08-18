type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const CAP_COUNTER_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:cap-list.title": { de: "Nutzungslimits", en: "Usage caps", es: "Límites de uso" },
  "cap-counter:entity:cap-counter:field:capName": { de: "Limit", en: "Cap", es: "Límite" },
  "cap-counter:entity:cap-counter:field:value": { de: "Wert", en: "Value", es: "Valor" },
  "cap-counter:entity:cap-counter:field:periodStart": {
    de: "Periodenstart",
    en: "Period start",
    es: "Inicio del período",
  },
  "cap-counter:entity:cap-counter:field:lastSoftWarnedAt": {
    de: "Letzte Soft-Warnung",
    en: "Last soft warning",
    es: "Última advertencia suave",
  },
};
