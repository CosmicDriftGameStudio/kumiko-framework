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
};

const translations: TranslationsByLocale = { en: labels, de: labels };

export const examplesClient: ClientFeatureDefinition = {
  name: "examples",
  translations,
};
