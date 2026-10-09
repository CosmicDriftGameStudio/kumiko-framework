import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema.js";
import { defineFeature } from "../define-feature.js";
import { createRegistry } from "../registry.js";

describe("buildAppSchema — select conditionalOptions", () => {
  test("an entity select field keeps its conditional option rules in the client schema", () => {
    const monitoring = defineFeature("monitoring", (r) => {
      r.entity("monitor", {
        fields: {
          kind: { type: "select", options: ["http", "heartbeat"] },
          interval: {
            type: "select",
            options: ["60", "3600"],
            conditionalOptions: [{ options: ["3600"], when: { field: "kind", eq: "heartbeat" } }],
          },
        },
      });
    });

    const app = buildAppSchema(createRegistry([monitoring]));
    const field = app.features.find((f) => f.featureName === "monitoring")?.entities["monitor"]
      ?.fields["interval"];
    expect(field).toMatchObject({
      conditionalOptions: [{ options: ["3600"], when: { field: "kind", eq: "heartbeat" } }],
    });
  });
});
