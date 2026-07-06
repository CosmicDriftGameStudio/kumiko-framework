import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "delivery.log.title": "Delivery-Log",
    "delivery.log.loading": "Lade Zustellversuche…",
    "delivery.log.empty": "Keine Zustellversuche.",
    "delivery.log.col.type": "Typ",
    "delivery.log.col.channel": "Kanal",
    "delivery.log.col.recipient": "Empfänger",
    "delivery.log.col.status": "Status",
    "delivery:nav.deliveryLog": "Zustellungen",
  },
  en: {
    "delivery.log.title": "Delivery log",
    "delivery.log.loading": "Loading delivery attempts…",
    "delivery.log.empty": "No delivery attempts.",
    "delivery.log.col.type": "Type",
    "delivery.log.col.channel": "Channel",
    "delivery.log.col.recipient": "Recipient",
    "delivery.log.col.status": "Status",
    "delivery:nav.deliveryLog": "Delivery",
  },
};
