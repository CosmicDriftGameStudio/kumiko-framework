import type {
  ClientFeatureDefinition,
  TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer-web";
import { Gallery } from "./Gallery";

const labels: Record<string, string> = {
  "gallery.field-error": "Enter a valid value.",
};
const translations: TranslationsByLocale = { en: labels, de: labels };

export const galleryClient: ClientFeatureDefinition = {
  name: "gallery",
  translations,
  components: { gallery: Gallery },
};
