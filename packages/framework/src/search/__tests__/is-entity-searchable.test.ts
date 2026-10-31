import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { isEntitySearchable } from "../is-entity-searchable.ts";

const feature = defineFeature("searchable-probe", (r) => {
  r.entity({
    name: "indexed",
    ...createEntity({
      table: "probe_indexed",
      fields: {
        title: createTextField({ searchable: true, personal: false, reason: "test_fixture" }),
      },
    }),
  });
  r.entity({
    name: "plain",
    ...createEntity({
      table: "probe_plain",
      fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  });
});

describe("isEntitySearchable", () => {
  const registry = createRegistry([feature]);

  test("true for an entity with a searchable field", () => {
    expect(isEntitySearchable(registry, "indexed")).toBe(true);
  });

  test("false for an entity without searchable fields or payload extensions", () => {
    expect(isEntitySearchable(registry, "plain")).toBe(false);
  });
});
