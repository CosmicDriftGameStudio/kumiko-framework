import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity.ts";

// wireCustomFieldsFor: a single call registers MSP + postQuery hook +
// search-payload extension + useExtension marker. Tests pin the surface.

const propertyEntity = createEntity({
  table: "read_test_properties",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    customFields: customFieldsField(),
  },
});

const propertyTable = buildEntityTable("property", propertyEntity);

describe("wireCustomFieldsFor", () => {
  test("registers useExtension + MSP + postQuery-entity-hook + search-payload-extension", () => {
    const feature = defineFeature("test-property", (r) => {
      r.entity({ name: "property", ...propertyEntity });
      wireCustomFieldsFor(r, "property", propertyTable);
    });

    // 1. useExtension registered
    expect(feature.extensionUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extensionName: "customFields",
          entityName: "property",
        }),
      ]),
    );

    // 2. MSP registered with the right name
    expect(Object.keys(feature.multiStreamProjections)).toEqual(
      expect.arrayContaining(["custom-fields-property-projection"]),
    );

    // 3. postQuery entity-hook on "property"
    expect(feature.entityHooks?.postQuery?.["property"]).toHaveLength(1);

    // 4. search-payload-extension on "property"
    expect(feature.searchPayloadExtensions!["property"]).toHaveLength(1);
  });
});
