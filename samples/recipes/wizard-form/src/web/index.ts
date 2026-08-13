// Client-side registration for the review step's extension section (see
// ../feature.ts's `component: { react: { __component: "ListingReviewSection" } }`).
// A `kind: "extension"` section only resolves through
// clientFeatures.extensionSectionComponents (createKumikoApp → ExtensionSectionsProvider)
// — never imported directly from feature.ts, which keeps the server file
// free of the renderer-web graph. Without registering this export, an app
// mounting this recipe gets RenderEdit's fallback placeholder instead of
// the real review step.

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { ListingReviewSection } from "./listing-review-section";

export const listingsClient: ClientFeatureDefinition = {
  name: "listings",
  extensionSectionComponents: { ListingReviewSection },
};
