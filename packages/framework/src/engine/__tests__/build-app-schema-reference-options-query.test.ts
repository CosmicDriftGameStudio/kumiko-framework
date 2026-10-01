import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema.js";
import { defineFeature } from "../define-feature.js";
import { createRegistry } from "../registry.js";

// The edit renderer reads a reference field's picker source from the field
// definition it gets in the client schema, so optionsQuery must survive the
// projectField whitelist.
describe("buildAppSchema — reference optionsQuery", () => {
  test("a reference field's optionsQuery reaches the client schema entity field", () => {
    const leases = defineFeature("leases", (r) => {
      r.entity("lease", { fields: { startDate: { type: "text" } } });
    });
    const deposits = defineFeature("deposits", (r) => {
      r.entity("deposit", {
        fields: {
          leaseId: {
            type: "reference",
            entity: "leases:entity:lease",
            labelField: "startDate",
            optionsQuery: "deposits:query:lease:options",
          },
        } as never,
      });
    });

    const app = buildAppSchema(createRegistry([leases, deposits]));
    const field = app.features.find((f) => f.featureName === "deposits")?.entities["deposit"]
      ?.fields["leaseId"];
    expect(field).toMatchObject({
      type: "reference",
      optionsQuery: "deposits:query:lease:options",
    });
  });
});
