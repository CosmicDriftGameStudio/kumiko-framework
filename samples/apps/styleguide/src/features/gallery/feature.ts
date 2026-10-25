// Gallery feature (server). A custom screen showing the foundations
// (colors/typography/radius/elevation/spacing) + atomic components
// (buttons, cards) — what the entity auto-screens do not cover.
// React component assigned client-side via clientFeatures.components.
//
// Own FeatureName (not "styleguide") — two defineFeature calls with the same
// name would throw in createRegistry.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { LocalizedString } from "../shared-i18n";

// Server counterpart to the nav labels — the boot validator needs screen:gallery.title
// registered server-side, even if the custom screen itself does not pull a
// rendered title from i18n.
const GALLERY_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:gallery.title": { de: "Foundations & Components", en: "Foundations & Components" },
  "gallery:nav.styleguide": { de: "Styleguide", en: "Styleguide" },
  "gallery:nav.gallery": { de: "Foundations & Components", en: "Foundations & Components" },
};

export const galleryFeature = defineFeature("gallery", (r) => {
  r.translations({ keys: GALLERY_I18N });

  r.screen({ id: "gallery", type: "custom", renderer: { react: { __component: "gallery" } } });

  r.nav({ id: "styleguide", label: "gallery:nav.styleguide", icon: "palette", order: 20 });
  r.nav({
    id: "gallery",
    label: "gallery:nav.gallery",
    parent: "gallery:nav:styleguide",
    screen: "gallery:screen:gallery",
    icon: "sparkles",
    order: 10,
  });
});
