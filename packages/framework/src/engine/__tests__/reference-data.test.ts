import { describe, expect, test } from "vitest";
import { createEntity, createRegistry, createTextField, defineFeature } from "../index";

describe("r.referenceData()", () => {
  test("registers reference data on feature", () => {
    const feature = defineFeature("geo", (r) => {
      r.entity("country", createEntity({ table: "Countries", fields: { code: createTextField(), name: createTextField() } }));
      r.referenceData("country", [
        { code: "DE", name: "Deutschland" },
        { code: "AT", name: "Oesterreich" },
      ]);
    });

    expect(feature.referenceData).toHaveLength(1);
    expect(feature.referenceData[0]?.entityName).toBe("country");
    expect(feature.referenceData[0]?.data).toHaveLength(2);
  });

  test("supports custom upsert key", () => {
    const feature = defineFeature("geo", (r) => {
      r.entity("country", createEntity({ table: "Countries", fields: { code: createTextField(), name: createTextField() } }));
      r.referenceData("country", [{ code: "DE", name: "Deutschland" }], { upsertKey: "code" });
    });

    expect(feature.referenceData[0]?.upsertKey).toBe("code");
  });

  test("defaults upsertKey to undefined (first field)", () => {
    const feature = defineFeature("geo", (r) => {
      r.entity("country", createEntity({ table: "Countries", fields: { code: createTextField() } }));
      r.referenceData("country", [{ code: "DE" }]);
    });

    expect(feature.referenceData[0]?.upsertKey).toBeUndefined();
  });

  test("registry collects reference data from all features", () => {
    const f1 = defineFeature("geo", (r) => {
      r.entity("country", createEntity({ table: "Countries", fields: { code: createTextField() } }));
      r.referenceData("country", [{ code: "DE" }, { code: "AT" }]);
    });
    const f2 = defineFeature("fleet", (r) => {
      r.entity("vehicleType", createEntity({ table: "VehicleTypes", fields: { name: createTextField() } }));
      r.referenceData("vehicleType", [{ name: "Truck" }, { name: "Van" }]);
    });

    const registry = createRegistry([f1, f2]);
    const allData = registry.getAllReferenceData();
    expect(allData).toHaveLength(2);
    expect(allData[0]?.entityName).toBe("country");
    expect(allData[1]?.entityName).toBe("vehicleType");
  });
});
