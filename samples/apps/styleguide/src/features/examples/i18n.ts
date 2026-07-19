import type { LocalizedString } from "../shared-i18n";

export const EXAMPLES_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:shipping-edit.title": { de: "Lieferadresse", en: "Shipping Address" },
  "screen:shipping-edit.create.title": { de: "Lieferadresse", en: "Shipping Address" },
  "screen:shipping-edit.create.subtitle": {
    de: "Wohin sollen wir liefern?",
    en: "Where should we deliver?",
  },
  "screen:shipping-edit.edit.title": { de: "Lieferadresse", en: "Shipping Address" },
  "screen:shipping-edit.edit.subtitle": {
    de: "Aktualisiere deine Lieferadresse.",
    en: "Update your delivery address.",
  },
  "examples:shipping:submit": { de: "Adresse speichern", en: "Save Address" },
  "examples:entity:shipping:field:street": { de: "Straße", en: "Street address" },
  "examples:entity:shipping:field:apt": { de: "Wohnung / Suite", en: "Apt / Suite" },
  "examples:entity:shipping:field:city": { de: "Stadt", en: "City" },
  "examples:entity:shipping:field:state": { de: "Bundesland", en: "State" },
  "examples:entity:shipping:field:zip": { de: "PLZ", en: "ZIP Code" },
  "examples:entity:shipping:field:country": { de: "Land", en: "Country" },
  "examples:entity:shipping:field:saveAsDefault": {
    de: "Als Standardadresse speichern",
    en: "Save as default address",
  },
  "screen:profile-edit.title": { de: "Profil", en: "Profile" },
  "screen:profile-edit.create.title": { de: "Profil", en: "Profile" },
  "screen:profile-edit.create.subtitle": {
    de: "Aktualisiere deine persönlichen Daten und wie andere dich sehen.",
    en: "Update your personal information and how others see you.",
  },
  "screen:profile-edit.edit.title": { de: "Profil", en: "Profile" },
  "screen:profile-edit.edit.subtitle": {
    de: "Aktualisiere deine persönlichen Daten und wie andere dich sehen.",
    en: "Update your personal information and how others see you.",
  },
  "examples:profile:submit": { de: "Änderungen speichern", en: "Save changes" },
  "examples:entity:profile:field:avatar": { de: "Avatar", en: "Avatar" },
  "examples:entity:profile:field:fullName": { de: "Vollständiger Name", en: "Full name" },
  "examples:entity:profile:field:email": { de: "E-Mail", en: "Email" },
  "examples:entity:profile:field:bio": { de: "Bio", en: "Bio" },
  "screen:delivery-edit.title": { de: "Ort & Zeit", en: "Located date-time" },
  "screen:delivery-edit.create.title": { de: "Ort & Zeit", en: "Located date-time" },
  "screen:delivery-edit.create.subtitle": {
    de: "Eine Uhrzeit mit IANA-Zeitzone, dazu ein Kalenderdatum, ein UTC-Zeitpunkt und eine reine Zeitzone.",
    en: "A wall-clock time plus its IANA zone, alongside a calendar date, a UTC instant, and a bare zone.",
  },
  "screen:delivery-edit.edit.title": { de: "Ort & Zeit", en: "Located date-time" },
  "screen:delivery-edit.edit.subtitle": {
    de: "Eine Uhrzeit mit IANA-Zeitzone, dazu ein Kalenderdatum, ein UTC-Zeitpunkt und eine reine Zeitzone.",
    en: "A wall-clock time plus its IANA zone, alongside a calendar date, a UTC instant, and a bare zone.",
  },
  "examples:delivery:submit": { de: "Lieferung speichern", en: "Save delivery" },
  "examples:entity:delivery:field:label": { de: "Bezeichnung", en: "Label" },
  "examples:entity:delivery:field:pickup": {
    de: "Abholung (Uhrzeit + Zone)",
    en: "Pickup (wall-clock + zone)",
  },
  "examples:entity:delivery:field:dropoffOn": { de: "Abgabedatum", en: "Drop-off date" },
  "examples:entity:delivery:field:bookedAt": {
    de: "Gebucht am (UTC-Zeitpunkt)",
    en: "Booked at (UTC instant)",
  },
  "examples:entity:delivery:field:homeZone": { de: "Heimatzone Kurier", en: "Courier home zone" },
};
