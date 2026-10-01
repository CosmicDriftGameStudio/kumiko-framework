import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture.js";
import { validateBoot as validateBootRaw } from "../boot-validator.js";
import { createTenantConfig } from "../config-helpers.js";
import { defineFeature } from "../define-feature.js";
import type { ConfigKeyDefinition } from "../types/index.js";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN_ACCESS = {
  openToAll: { reason: "test handler callable by any signed-in test user" },
} as const;

const catalog = defineFeature("catalog", (r) => {
  r.queryHandler("model-options", z.object({}), async () => ({ rows: [] }), {
    access: OPEN_ACCESS,
  });
});

function featureWithConfigKey(key: ConfigKeyDefinition) {
  return defineFeature("shop", (r) => {
    r.config({ keys: { model: key } });
  });
}

describe("validateBoot — select optionsQuery on config keys", () => {
  test("a select key with a registered optionsQuery and payload boots", () => {
    const shop = featureWithConfigKey(
      createTenantConfig("select", {
        optionsQuery: "catalog:query:model-options",
        optionsQueryPayload: { modality: "text", provider: "anthropic" },
      }),
    );
    expect(() => validateBoot([catalog, shop])).not.toThrow();
  });

  test("a dead optionsQuery QN throws", () => {
    const shop = featureWithConfigKey(
      createTenantConfig("select", { optionsQuery: "catalog:query:ghost" }),
    );
    expect(() => validateBoot([catalog, shop])).toThrow(
      /Config key "model" optionsQuery query "catalog:query:ghost" is not a registered query-handler/,
    );
  });

  test("optionsQuery on a non-select key throws", () => {
    const shop = featureWithConfigKey({
      ...createTenantConfig("text"),
      optionsQuery: "catalog:query:model-options",
    });
    expect(() => validateBoot([catalog, shop])).toThrow(/only valid on select keys/);
  });

  test("optionsQuery together with non-empty options throws", () => {
    const shop = featureWithConfigKey(
      createTenantConfig("select", {
        options: ["a"],
        optionsQuery: "catalog:query:model-options",
      }),
    );
    expect(() => validateBoot([catalog, shop])).toThrow(/both options and optionsQuery/);
  });

  test("an empty optionsQuery string throws", () => {
    const shop = featureWithConfigKey(createTenantConfig("select", { optionsQuery: "" }));
    expect(() => validateBoot([catalog, shop])).toThrow(/empty optionsQuery/);
  });

  test("optionsQueryPayload without optionsQuery throws", () => {
    const shop = featureWithConfigKey(
      createTenantConfig("select", { optionsQueryPayload: { provider: "anthropic" } }),
    );
    expect(() => validateBoot([catalog, shop])).toThrow(/optionsQueryPayload without optionsQuery/);
  });

  test("optionsQuery together with allowPerRequest throws", () => {
    const shop = featureWithConfigKey(
      createTenantConfig("select", {
        optionsQuery: "catalog:query:model-options",
        allowPerRequest: true,
      }),
    );
    expect(() => validateBoot([catalog, shop])).toThrow(/optionsQuery AND allowPerRequest/);
  });
});

function featureWithActionForm(fields: Record<string, unknown>) {
  return defineFeature("shop", (r) => {
    r.writeHandler({
      name: "restock",
      schema: { _type: "stub" } as never,
      handler: async () => ({ isSuccess: true, data: {} }) as never,
      access: OPEN_ACCESS,
    });
    r.screen({
      id: "restock",
      type: "actionForm",
      handler: "shop:write:restock",
      fields: fields as never,
      layout: { sections: [{ fields: Object.keys(fields) }] } as never,
    });
  });
}

function featureWithConfigEdit(fields: Record<string, unknown>) {
  return defineFeature("shop", (r) => {
    r.config({ keys: { model: createTenantConfig("text", { default: "" }) } });
    r.screen({
      id: "settings",
      type: "configEdit",
      scope: "tenant",
      configKeys: { model: "shop:config:model" },
      fields: fields as never,
      layout: { sections: [{ title: "Basics", fields: Object.keys(fields) }] } as never,
    });
  });
}

describe.each([
  ["actionForm", featureWithActionForm],
  ["configEdit", featureWithConfigEdit],
] as const)("validateBoot — select optionsQuery on %s fields", (_screenType, build) => {
  const query = "catalog:query:model-options";

  test("empty options with a registered optionsQuery boots", () => {
    const shop = build({
      model: { type: "select", options: [], optionsQuery: query, optionsQueryPayload: { a: 1 } },
    });
    expect(() => validateBoot([catalog, shop])).not.toThrow();
  });

  test("a dead optionsQuery QN throws", () => {
    const shop = build({
      model: { type: "select", options: [], optionsQuery: "catalog:query:ghost" },
    });
    expect(() => validateBoot([catalog, shop])).toThrow(
      /select field "model" optionsQuery query "catalog:query:ghost" is not a registered query-handler/,
    );
  });

  test("non-empty options together with optionsQuery throws", () => {
    const shop = build({ model: { type: "select", options: ["a"], optionsQuery: query } });
    expect(() => validateBoot([catalog, shop])).toThrow(/both options and optionsQuery/);
  });

  test("an empty optionsQuery string throws", () => {
    const shop = build({ model: { type: "select", options: [], optionsQuery: "" } });
    expect(() => validateBoot([catalog, shop])).toThrow(/empty optionsQuery/);
  });

  test("optionsQueryPayload without optionsQuery throws", () => {
    const shop = build({
      model: { type: "select", options: ["a"], optionsQueryPayload: { a: 1 } },
    });
    expect(() => validateBoot([catalog, shop])).toThrow(/optionsQueryPayload without optionsQuery/);
  });
});

describe("validateBoot — select optionsQuery on entity fields", () => {
  test("a top-level entity select field with optionsQuery throws", () => {
    const shop = defineFeature("shop", (r) => {
      r.entity("item", {
        fields: {
          model: { type: "select", options: [], optionsQuery: "catalog:query:model-options" },
        } as never,
      });
    });
    expect(() => validateBoot([catalog, shop])).toThrow(
      /Entity select field "item.model" declares optionsQuery.*not be validated against the query result/,
    );
  });

  test("an embedded select sub-field with optionsQuery throws", () => {
    const shop = defineFeature("shop", (r) => {
      r.entity("item", {
        fields: {
          meta: {
            type: "embedded",
            schema: {
              model: { type: "select", options: [], optionsQuery: "catalog:query:model-options" },
            },
          },
        } as never,
      });
    });
    expect(() => validateBoot([catalog, shop])).toThrow(
      /Entity select field "item.meta.model" declares optionsQuery/,
    );
  });
});
