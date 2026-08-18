type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const DELIVERY_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:delivery-log.title": {
    de: "Delivery-Log",
    en: "Delivery log",
    es: "Registro de entregas",
  },
  "delivery:nav.deliveryLog": { de: "Zustellungen", en: "Delivery", es: "Entregas" },
};
