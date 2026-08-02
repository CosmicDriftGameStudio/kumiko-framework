import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// Nav labels for the two content collections this app mounts. Collection ids
// are the app's choice, so their labels are too — a bundled feature cannot ship
// a translation key for a collection it never named. Every app that declares a
// collection carries its labels the same way.
export const collectionLabelsFeature = defineFeature("collection-labels", (r) => {
  r.describe("Nav labels for the content collections mounted by this sample app.");
  r.translations({
    keys: {
      "templateResolver:nav.snippets": { de: "Bausteine", en: "Snippets" },
      "templateResolver:nav.signatures": { de: "Signaturen", en: "Signatures" },
    },
  });
  return {};
});
