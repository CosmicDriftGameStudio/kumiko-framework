import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

// Screen gate probe: the dispatcher's feature gate rejects every handler of a
// toggleable feature the tenant's tier does not include, so this query only
// answers for tenants that may use tokens — a rejection makes the screens'
// visibleWhen fall back instead of rendering an unusable token list.
export const availabilityQuery = defineQueryHandler({
  name: "availability",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "constant answer that only exists to be gated by the feature toggle; it carries no user or tenant data",
    },
  },
  description:
    "Reports that personal access tokens are available to the caller's tenant; fails with feature_disabled when the tenant's tier excludes them. The token screens use it to decide whether to render.",
  handler: async () => ({ enabled: true }),
});
