import { describe, expect, test } from "bun:test";
import {
  createEmbeddedField,
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine";
import { deriveSearchAdapterConfig } from "../derive-search-adapter-config";

describe("deriveSearchAdapterConfig", () => {
  test("returns undefined for an empty registry", () => {
    expect(deriveSearchAdapterConfig(createRegistry([]))).toBeUndefined();
  });

  test("returns undefined when no entity has a searchable field", () => {
    const feature = defineFeature("plain", (r) => {
      r.entity(
        "note",
        createEntity({
          table: "notes",
          fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
    });

    expect(deriveSearchAdapterConfig(createRegistry([feature]))).toBeUndefined();
  });

  test("unions searchable fields across entities, deduplicated, in first-occurrence order", () => {
    const feature = defineFeature("crm", (r) => {
      r.entity(
        "customer",
        createEntity({
          table: "customers",
          fields: {
            title: createTextField({ searchable: true, personal: false, reason: "test_fixture" }),
            email: createTextField({ searchable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
      r.entity(
        "order",
        createEntity({
          table: "orders",
          fields: {
            title: createTextField({ searchable: true, personal: false, reason: "test_fixture" }),
            note: createTextField({ searchable: true, personal: false, reason: "test_fixture" }),
            address: createEmbeddedField(
              { city: { type: "text", searchable: true } },
              { personal: false, reason: "test_fixture" },
            ),
          },
        }),
      );
    });

    const config = deriveSearchAdapterConfig(createRegistry([feature]));

    expect(config).toEqual({
      searchableFields: ["title", "email", "note", "address_city"],
      rankingFields: ["title", "email", "note", "address_city"],
    });
  });
});
