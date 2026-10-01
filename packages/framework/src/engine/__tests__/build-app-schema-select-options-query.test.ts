import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { buildAppSchema } from "../build-app-schema.js";
import { SETTINGS_HUB_FEATURE } from "../build-config-feature-schema.js";
import { createTenantConfig } from "../config-helpers.js";
import { defineFeature } from "../define-feature.js";
import { projectAppSchemaForRoles } from "../project-app-schema-for-roles.js";
import { createRegistry } from "../registry.js";

const catalog = defineFeature("catalog", (r) => {
  r.queryHandler("model-options", z.object({}), async () => ({ rows: [] }), {
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

const aiProvider = defineFeature("ai-provider", (r) => {
  r.config({
    keys: {
      model: createTenantConfig("select", {
        mask: { title: "ai-provider.model" },
        optionsQuery: "catalog:query:model-options",
        optionsQueryPayload: { modality: "text", provider: "anthropic" },
      }),
    },
  });
});

describe("select config key with optionsQuery: key → client schema → role projection", () => {
  const app = buildAppSchema(createRegistry([catalog, aiProvider]));

  function modelField(schema: ReturnType<typeof buildAppSchema>) {
    const hub = schema.features.find((f) => f.featureName === SETTINGS_HUB_FEATURE);
    const screen = hub?.screens.find((s) => s.type === "configEdit");
    if (screen?.type !== "configEdit") throw new Error("configEdit hub screen missing");
    return screen.fields["model"];
  }

  test("the generated hub field carries options:[] plus optionsQuery and payload", () => {
    expect(modelField(app)).toMatchObject({
      type: "select",
      options: [],
      optionsQuery: "catalog:query:model-options",
      optionsQueryPayload: { modality: "text", provider: "anthropic" },
    });
  });

  test("a TenantAdmin projection keeps them", () => {
    const projected = projectAppSchemaForRoles(app, ["TenantAdmin"]);
    expect(modelField(projected)).toMatchObject({
      type: "select",
      options: [],
      optionsQuery: "catalog:query:model-options",
      optionsQueryPayload: { modality: "text", provider: "anthropic" },
    });
  });
});
