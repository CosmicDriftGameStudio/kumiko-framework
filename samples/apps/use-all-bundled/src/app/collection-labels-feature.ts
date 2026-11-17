import { TEMPLATE_RESOLVER_FEATURE } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  defineFeature,
  handlerTranslationKeys,
  type TranslationEntry,
} from "@cosmicdrift/kumiko-framework/engine";

// Nav, entry and assistant labels for the two content collections this app mounts.
// Collection ids are the app's choice, so their labels are too — a bundled feature
// cannot ship a translation key for a collection it never named. That includes the
// title and field labels of each collection's `<id>-set` handler, which the AI
// assistant shows and `kumiko agent lint` requires. Every app that declares a
// collection carries its labels the same way.
const COLLECTION_SET_FIELD_LABELS: Readonly<Record<string, TranslationEntry>> = {
  slug: { de: "Kennung", en: "Identifier" },
  locale: { de: "Sprache", en: "Language" },
  title: { de: "Titel", en: "Title" },
  content: { de: "Inhalt", en: "Content" },
  folder: { de: "Ordner", en: "Folder" },
  createOnly: { de: "Nur neu anlegen", en: "Create only" },
  tenantIdOverride: { de: "Zielmandant", en: "Target organization" },
};

export const collectionLabelsFeature = defineFeature("collection-labels", (r) => {
  r.describe("Nav labels for the content collections mounted by this sample app.");
  r.translations({
    keys: {
      "templateResolver:nav.snippets": { de: "Bausteine", en: "Snippets" },
      "templateResolver:nav.snippet": { de: "Baustein", en: "Snippet" },
      "templateResolver:nav.signatures": { de: "Signaturen", en: "Signatures" },
      "templateResolver:nav.signature": { de: "Signatur", en: "Signature" },
      ...handlerTranslationKeys(TEMPLATE_RESOLVER_FEATURE, {
        writes: {
          "reply-snippets-set": {
            title: { de: "Textbaustein speichern", en: "Save reply snippet" },
            fields: COLLECTION_SET_FIELD_LABELS,
          },
          "signatures-set": {
            title: { de: "Signatur speichern", en: "Save signature" },
            fields: COLLECTION_SET_FIELD_LABELS,
          },
        },
      }),
    },
  });
  return {};
});
