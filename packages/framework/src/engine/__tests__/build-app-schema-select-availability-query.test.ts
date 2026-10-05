import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema.js";
import { defineFeature } from "../define-feature.js";
import { createRegistry } from "../registry.js";

// The edit renderer loads the availability of a select's static options from the
// field definition in the client schema, so optionsAvailabilityQuery must survive
// the projectField whitelist.
describe("buildAppSchema — select optionsAvailabilityQuery", () => {
  test("an entity select field keeps its options and availability query in the client schema", () => {
    const shop = defineFeature("shop", (r) => {
      r.entity("subscription", {
        fields: {
          plan: {
            type: "select",
            options: ["free", "pro"],
            optionsAvailabilityQuery: "shop:query:plan-availability",
          },
        },
      });
    });

    const app = buildAppSchema(createRegistry([shop]));
    const field = app.features.find((f) => f.featureName === "shop")?.entities["subscription"]
      ?.fields["plan"];
    expect(field).toMatchObject({
      type: "select",
      options: ["free", "pro"],
      optionsAvailabilityQuery: "shop:query:plan-availability",
    });
  });
});
