import type {
  ClientFeatureDefinition,
  TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer-web";

const labels: Record<string, string> = {
  "screen:shipping-edit.create.title": "Shipping Address",
  "screen:shipping-edit.create.subtitle": "Where should we deliver?",
  "screen:shipping-edit.edit.title": "Shipping Address",
  "screen:shipping-edit.edit.subtitle": "Update your delivery address.",
  "examples:shipping:submit": "Save Address",
  "examples:entity:shipping:field:street": "Street address",
  "examples:entity:shipping:field:apt": "Apt / Suite",
  "examples:entity:shipping:field:city": "City",
  "examples:entity:shipping:field:state": "State",
  "examples:entity:shipping:field:zip": "ZIP Code",
  "examples:entity:shipping:field:country": "Country",
  "examples:entity:shipping:field:saveAsDefault": "Save as default address",
  "screen:profile-edit.create.title": "Profile",
  "screen:profile-edit.create.subtitle": "Update your personal information and how others see you.",
  "screen:profile-edit.edit.title": "Profile",
  "screen:profile-edit.edit.subtitle": "Update your personal information and how others see you.",
  "examples:profile:submit": "Save changes",
  "examples:entity:profile:field:avatar": "Avatar",
  "examples:entity:profile:field:fullName": "Full name",
  "examples:entity:profile:field:email": "Email",
  "examples:entity:profile:field:bio": "Bio",
  "screen:delivery-edit.create.title": "Located date-time",
  "screen:delivery-edit.create.subtitle":
    "A wall-clock time plus its IANA zone, alongside a calendar date, a UTC instant, and a bare zone.",
  "screen:delivery-edit.edit.title": "Located date-time",
  "screen:delivery-edit.edit.subtitle":
    "A wall-clock time plus its IANA zone, alongside a calendar date, a UTC instant, and a bare zone.",
  "examples:delivery:submit": "Save delivery",
  "examples:entity:delivery:field:label": "Label",
  "examples:entity:delivery:field:pickup": "Pickup (wall-clock + zone)",
  "examples:entity:delivery:field:dropoffOn": "Drop-off date",
  "examples:entity:delivery:field:bookedAt": "Booked at (UTC instant)",
  "examples:entity:delivery:field:homeZone": "Courier home zone",
};

const translations: TranslationsByLocale = { en: labels, de: labels };

export const examplesClient: ClientFeatureDefinition = {
  name: "examples",
  translations,
};
