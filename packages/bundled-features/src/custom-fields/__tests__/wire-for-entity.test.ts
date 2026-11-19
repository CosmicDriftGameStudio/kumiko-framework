import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createCustomFieldsFeature } from "../feature.ts";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity.ts";

// wireCustomFieldsFor: a single call registers rebuild extension + postQuery
// hook + search-payload extension + useExtension marker (no MSP; the
// custom-fields feature owns the one values projection). Tests pin the surface.

const propertyEntity = createEntity({
  name: "property",
  table: "read_test_properties",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    customFields: customFieldsField(),
  },
});

const propertyTable = buildEntityTable(propertyEntity);

describe("wireCustomFieldsFor", () => {
  test("registers useExtension + rebuild extension + postQuery-entity-hook + search-payload-extension", () => {
    const feature = defineFeature("test-property", (r) => {
      r.entity(propertyEntity);
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

    // 2. no MSP per host; the custom-fields feature owns the one values projection
    expect(Object.keys(feature.multiStreamProjections)).toEqual([]);
    expect(Object.keys(createCustomFieldsFeature().multiStreamProjections)).toEqual([
      "host-values",
    ]);

    // 3. postQuery entity-hook on "property"
    expect(feature.entityHooks?.postQuery?.["property"]).toHaveLength(1);

    // 4. search-payload-extension on "property"
    expect(feature.searchPayloadExtensions!["property"]).toHaveLength(1);
  });
});
