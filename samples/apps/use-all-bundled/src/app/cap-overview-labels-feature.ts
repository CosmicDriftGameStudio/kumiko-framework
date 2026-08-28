import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// Labels for the three example caps (notes, tags, seats) wired up in
// cap-overview-caps.ts. Cap ids are the app's choice, so their labels are
// too — cap-overview itself carries no vocabulary for app-owned caps, same
// reasoning as collection-labels-feature.ts for content collections.
export const capOverviewLabelsFeature = defineFeature("cap-overview-labels", (r) => {
  r.describe("Labels for the example caps this sample app mounts into cap-overview.");
  r.translations({
    keys: {
      "cap-overview.caps.notes": { de: "Notizen", en: "Notes" },
      "cap-overview.caps.tags": { de: "Tags", en: "Tags" },
      "cap-overview.caps.seats": { de: "Plätze", en: "Seats" },
    },
  });
  return {};
});
