import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { customFieldsField, wireCustomFieldsFor } from "../wire-for-entity";

// B2 wireCustomFieldsFor: einziger Aufruf registriert MSP + postQuery-hook +
// search-payload-extension + useExtension-Marker. Tests pinnen die Surface
// — Integration via setupTestStack kommt im T1 sprint.

const propertyEntity = createEntity({
  table: "read_test_properties",
  fields: {
    name: createTextField({ required: true }),
    customFields: customFieldsField(),
  },
});

const propertyTable = buildEntityTable("property", propertyEntity);

describe("wireCustomFieldsFor", () => {
  test("registers useExtension + MSP + postQuery-entity-hook + search-payload-extension", () => {
    const feature = defineFeature("test-property", (r) => {
      r.entity("property", propertyEntity);
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

  test("postQuery-hook flattens row.customFields onto root", async () => {
    const feature = defineFeature("test-property", (r) => {
      r.entity("property", propertyEntity);
      wireCustomFieldsFor(r, "property", propertyTable);
    });

    const hook = feature.entityHooks?.postQuery?.["property"]?.[0]?.fn;
    expect(hook).toBeDefined();
    const result = await hook?.(
      {
        entityName: "property",
        rows: [
          {
            id: "p1",
            name: "Hofgarten",
            customFields: { internalNumber: "X-42", vipFlag: true },
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as never,
    );
    expect(result?.rows[0]).toMatchObject({
      id: "p1",
      name: "Hofgarten",
      internalNumber: "X-42",
      vipFlag: true,
    });
  });

  test("postQuery-hook lets base columns win over shadowing custom fieldKeys", async () => {
    const feature = defineFeature("test-property", (r) => {
      r.entity("property", propertyEntity);
      wireCustomFieldsFor(r, "property", propertyTable);
    });

    const hook = feature.entityHooks?.postQuery?.["property"]?.[0]?.fn;
    const result = await hook?.(
      {
        entityName: "property",
        rows: [
          {
            id: "p1",
            name: "Hofgarten",
            // a malicious/colliding custom fieldKey must not shadow the real column
            customFields: { id: "spoofed", name: "spoofed", internalNumber: "X-42" },
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as never,
    );
    expect(result?.rows[0]).toMatchObject({
      id: "p1",
      name: "Hofgarten",
      internalNumber: "X-42",
    });
  });

  test("postQuery-hook handles missing/invalid customFields gracefully", async () => {
    const feature = defineFeature("test-property", (r) => {
      r.entity("property", propertyEntity);
      wireCustomFieldsFor(r, "property", propertyTable);
    });

    const hook = feature.entityHooks?.postQuery?.["property"]?.[0]?.fn;
    const result = await hook?.(
      {
        entityName: "property",
        rows: [
          { id: "p1", name: "NoCustomFields" }, // missing customFields
          { id: "p2", name: "WithEmpty", customFields: {} },
          { id: "p3", name: "WithNull", customFields: null },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as never,
    );
    expect(result?.rows).toHaveLength(3);
    expect(result?.rows[0]).toMatchObject({ id: "p1", name: "NoCustomFields" });
    expect(result?.rows[1]).toMatchObject({ id: "p2", name: "WithEmpty" });
    expect(result?.rows[2]).toMatchObject({ id: "p3", name: "WithNull" });
  });

  test("search-payload-extension returns customFields keys flat", async () => {
    const feature = defineFeature("test-property", (r) => {
      r.entity("property", propertyEntity);
      wireCustomFieldsFor(r, "property", propertyTable);
    });

    const contributor = feature.searchPayloadExtensions!["property"]?.[0]?.fn;
    expect(contributor).toBeDefined();
    const result = await contributor?.({
      entityName: "property",
      entityId: "p1",
      state: {
        id: "p1",
        name: "Hofgarten",
        customFields: { internalNumber: "X-42", vipFlag: true },
      },
    });
    expect(result).toEqual({ internalNumber: "X-42", vipFlag: true });
  });
});
