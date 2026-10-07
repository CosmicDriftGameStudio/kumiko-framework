import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture.js";
import { validateBoot as validateBootRaw } from "../boot-validator.js";
import { createSystemConfig, createTenantConfig } from "../config-helpers.js";
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
    r.config({
      keys: Object.fromEntries(
        Object.keys(fields).map((name) => [name, createTenantConfig("text", { default: "" })]),
      ),
    });
    r.screen({
      id: "settings",
      type: "configEdit",
      scope: "tenant",
      configKeys: Object.fromEntries(
        Object.keys(fields).map((name) => [name, `shop:config:${name}`]),
      ),
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

function featureWithWriteForm(fieldDefs: Record<string, unknown>) {
  return defineFeature("shop", (r) => {
    r.queryHandler("thing", z.object({}), async () => ({ rows: [] }), { access: OPEN_ACCESS });
    r.writeHandler({
      name: "save",
      schema: { _type: "stub" } as never,
      handler: async () => ({ isSuccess: true, data: {} }) as never,
      access: OPEN_ACCESS,
    });
    r.screen({
      id: "detail",
      type: "projectionDetail",
      query: "shop:query:thing",
      layout: {
        sections: [
          {
            kind: "writeForm",
            title: "Edit",
            fieldDefs: fieldDefs as never,
            fields: Object.keys(fieldDefs),
            handler: "shop:write:save",
          },
        ],
      },
    });
  });
}

describe.each([
  ["actionForm", featureWithActionForm],
  ["configEdit", featureWithConfigEdit],
  ["writeForm", featureWithWriteForm],
] as const)("validateBoot — optionsQueryPayload { field } on %s fields", (_screenType, build) => {
  const query = "catalog:query:model-options";
  const provider = { type: "text" } as const;

  test("a { field } naming a sibling field boots", () => {
    const shop = build({
      provider,
      model: {
        type: "select",
        options: [],
        optionsQuery: query,
        optionsQueryPayload: { provider: { field: "provider" } },
      },
    });
    expect(() => validateBoot([catalog, shop])).not.toThrow();
  });

  test("a { field } naming an unknown field throws", () => {
    const shop = build({
      provider,
      model: {
        type: "select",
        options: [],
        optionsQuery: query,
        optionsQueryPayload: { provider: { field: "ghost" } },
      },
    });
    expect(() => validateBoot([catalog, shop])).toThrow(/references unknown field "ghost"/);
  });

  test("a { field } naming the field itself throws", () => {
    const shop = build({
      provider,
      model: {
        type: "select",
        options: [],
        optionsQuery: query,
        optionsQueryPayload: { provider: { field: "model" } },
      },
    });
    expect(() => validateBoot([catalog, shop])).toThrow(/references itself/);
  });
});

describe("validateBoot — writeForm select fields share the options XOR optionsQuery rule", () => {
  test("non-empty options together with optionsQuery throws", () => {
    const shop = featureWithWriteForm({
      model: { type: "select", options: ["a"], optionsQuery: "catalog:query:model-options" },
    });
    expect(() => validateBoot([catalog, shop])).toThrow(/both options and optionsQuery/);
  });
});

describe("validateBoot — optionsQueryPayload { field } on config keys", () => {
  const query = "catalog:query:model-options";

  function featureWithKeys(payload: Record<string, { field: string }>) {
    return defineFeature("shop", (r) => {
      r.config({
        keys: {
          provider: createTenantConfig("text", { default: "" }),
          model: createTenantConfig("select", {
            optionsQuery: query,
            optionsQueryPayload: payload,
          }),
        },
      });
    });
  }

  test("a { field } naming another key of the feature boots", () => {
    expect(() =>
      validateBoot([catalog, featureWithKeys({ provider: { field: "provider" } })]),
    ).not.toThrow();
  });

  test("a { field } naming an unknown key throws", () => {
    expect(() =>
      validateBoot([catalog, featureWithKeys({ provider: { field: "ghost" } })]),
    ).toThrow(/references unknown config key "ghost"/);
  });

  test("a { field } naming the key itself throws", () => {
    expect(() =>
      validateBoot([catalog, featureWithKeys({ provider: { field: "model" } })]),
    ).toThrow(/references itself/);
  });
});

describe.each([
  ["actionForm", featureWithActionForm],
  ["writeForm", featureWithWriteForm],
] as const)("validateBoot — writeOnly on %s fieldDefs", (_screenType, build) => {
  test("a writeOnly field in the form fieldDefs throws", () => {
    const shop = build({ apiKey: { type: "text", writeOnly: true } });
    expect(() => validateBoot([catalog, shop])).toThrow(/field "apiKey" declares writeOnly/);
  });
});

describe("validateBoot — writeOnly on configEdit fields follows the key's encryption", () => {
  function featureWithSecretKey(key: ConfigKeyDefinition, scope: "tenant" | "system" = "tenant") {
    return defineFeature("shop", (r) => {
      r.config({ keys: { token: key } });
      r.screen({
        id: "settings",
        type: "configEdit",
        scope,
        configKeys: { token: "shop:config:token" },
        fields: { token: { type: "text", writeOnly: true } } as never,
        layout: { sections: [{ title: "Basics", fields: ["token"] }] } as never,
      });
    });
  }

  test("a writeOnly field on an encrypted key boots", () => {
    const shop = featureWithSecretKey(createTenantConfig("text", { encrypted: true }));
    expect(() => validateBoot([shop])).not.toThrow();
  });

  test("a writeOnly field on a secrets-backed key boots", () => {
    const shop = featureWithSecretKey(createSystemConfig("text", { backing: "secrets" }), "system");
    expect(() => validateBoot([shop])).not.toThrow();
  });

  test("a writeOnly field on a plain key throws", () => {
    const shop = featureWithSecretKey(createTenantConfig("text", { default: "" }));
    expect(() => validateBoot([shop])).toThrow(
      /field "token" declares writeOnly but config key "shop:config:token" is not encrypted at rest/,
    );
  });
});

describe("validateBoot — select optionsAvailabilityQuery on entity fields", () => {
  const planEntity = (optionsAvailabilityQuery: string) =>
    defineFeature("shop", (r) => {
      r.entity("item", {
        fields: {
          plan: { type: "select", options: ["free", "pro"], optionsAvailabilityQuery },
        },
      });
    });

  test("a registered availability query boots next to static options", () => {
    expect(() => validateBoot([catalog, planEntity("catalog:query:model-options")])).not.toThrow();
  });

  test("a dead availability QN throws", () => {
    expect(() => validateBoot([catalog, planEntity("catalog:query:ghost")])).toThrow(
      /Select field "plan" on entity "item" declares optionsAvailabilityQuery "catalog:query:ghost" which is not a registered query-handler/,
    );
  });
});

describe("validateBoot — select optionTones", () => {
  test("an unknown tone on an entity select field throws, a known one boots", () => {
    const withTone = (tone: string) =>
      defineFeature("shop", (r) => {
        r.entity("item", {
          fields: {
            state: { type: "select", options: ["open"], optionTones: { open: tone } },
          } as never,
        });
      });
    expect(() => validateBoot([withTone("ok")])).not.toThrow();
    expect(() => validateBoot([withTone("error")])).toThrow(
      /Entity select field "item.state" optionTones\["open"\] is "error"/,
    );
  });
});
