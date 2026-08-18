type LocalizedString = { readonly de: string; readonly en: string };

export const DELIVERY_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:delivery-log.title": { de: "Delivery-Log", en: "Delivery log" },
  "delivery:nav.deliveryLog": { de: "Zustellungen", en: "Delivery" },
};
