import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";
import { createRegistry } from "../registry.js";

const carEntity = createEntity({
  table: "exclude_registry_cars",
  fields: {
    vin: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    model: createTextField({ personal: false, reason: "test_fixture" }),
    internalNote: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

const plainEntity = createEntity({
  table: "exclude_registry_plain",
  fields: { label: createTextField({ personal: false, reason: "test_fixture" }) },
});

const feature = defineFeature("exclude-registry", (r) => {
  r.crud("car", carEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
    excludeFields: { create: ["internalNote"], update: ["vin"] },
  });
  r.crud("plain", plainEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
  });
  r.screen({
    id: "car-edit",
    type: "entityEdit",
    entity: "car",
    layout: { sections: [{ fields: ["vin", "model", "internalNote"] }] },
  });
  r.screen({
    id: "plain-edit",
    type: "entityEdit",
    entity: "plain",
    layout: { sections: [{ fields: ["label"] }] },
  });
  r.screen({
    id: "plain-authored-edit",
    type: "entityEdit",
    entity: "plain",
    layout: { sections: [{ fields: ["label"] }] },
    writeExcludedFields: { create: ["label"] },
  });
});

describe("excludeFields survives handler registration", () => {
  const registry = createRegistry([feature]);

  test("the registered create/update handler defs carry their own exclusion list", () => {
    expect(registry.getWriteHandler("exclude-registry:write:car:create")?.excludedFields).toEqual([
      "internalNote",
    ]);
    expect(registry.getWriteHandler("exclude-registry:write:car:update")?.excludedFields).toEqual([
      "vin",
    ]);
  });

  test("verbs without exclusions and other write verbs carry no list", () => {
    expect(registry.getWriteHandler("exclude-registry:write:car:delete")).toBeDefined();
    expect(registry.getWriteHandler("exclude-registry:write:car:delete")).not.toHaveProperty(
      "excludedFields",
    );
    expect(registry.getWriteHandler("exclude-registry:write:plain:create")).not.toHaveProperty(
      "excludedFields",
    );
  });
});

describe("buildAppSchema projects excludeFields onto entityEdit screens", () => {
  const screens = buildAppSchema(createRegistry([feature])).features[0]?.screens ?? [];
  const screenById = (id: string) => screens.find((s) => s.id.endsWith(id));

  test("the entityEdit screen carries the per-verb lists the renderer reads", () => {
    expect(screenById("car-edit")).toMatchObject({
      writeExcludedFields: { create: ["internalNote"], update: ["vin"] },
    });
  });

  test("a screen of an entity without exclusions gets no property", () => {
    expect(screenById("plain-edit")).not.toHaveProperty("writeExcludedFields");
  });

  test("an authored list never survives: the registry-derived value (or none) wins", () => {
    expect(screenById("plain-authored-edit")).not.toHaveProperty("writeExcludedFields");
  });
});
