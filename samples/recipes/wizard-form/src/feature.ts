// Wizard Form Sample
// Shows: EditLayout.mode: "wizard" splitting one entityEdit screen into
// steps, a review step (kind: "extension") that reads the host form's
// live values through ExtensionSectionProps.values instead of its own
// fetch, and draft: true resuming an in-progress wizard via the bundled
// form-draft feature — the actual save/get/discard wiring is automatic
// client-side, this feature only turns the two flags on. form-draft itself
// requires the bundled "config" feature (its retention-days setting), so
// any app mounting this recipe must mount that too.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { listingEntity } from "./entities/listing";

export { listingEntity } from "./entities/listing";

const editorWrite = { access: { roles: ["Admin", "User"] } } as const;
const openRead = {
  access: {
    openToAll: {
      reason:
        "any signed-in user may list and view listings; writes are still gated by editorWrite",
    },
  },
} as const;

export const listingsFeature = defineFeature("listings", (r) => {
  r.crud("listing", listingEntity, { write: editorWrite, read: openRead });

  r.screen({
    id: "listing-wizard",
    type: "entityEdit",
    entity: "listing",
    layout: {
      mode: "wizard",
      draft: true,
      wizard: {
        aside: { upNext: true, finishDescription: "Publishes the listing." },
        saveAndCloseOnCreate: true,
        // UI-only: the write handler would still accept a vehicle listing.
        submitDisabledWhen: { field: "category", eq: "vehicles" },
      },
      sections: [
        {
          title: "Basics",
          subtitle: "Title and category",
          summaryField: "title",
          fields: ["title", "category"],
        },
        { title: "Pricing", subtitle: "Price and condition", fields: ["price", "condition"] },
        {
          kind: "extension",
          title: "Review",
          component: { react: { __component: "ListingReviewSection" } },
        },
      ],
    },
    access: editorWrite.access,
  });
});
