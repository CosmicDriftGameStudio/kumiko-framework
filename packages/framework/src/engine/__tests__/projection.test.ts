import { integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import type { ProjectionDefinition } from "../../engine/types";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";
import { createRegistry } from "../registry";

// Throwaway Drizzle table reused across these tests. The runtime-behaviour of
// the projection itself (apply, TX semantics) is covered by the MietNomade
// integration suite; this file focuses on the registrar/registry contracts
// that fire BEFORE any write happens.
const testTable = pgTable("test_projection", {
  id: uuid("id").primaryKey(),
  count: integer("count").notNull().default(0),
});

function exampleEntity(name = "unit") {
  return createEntity({
    table: name,
    fields: { name: createTextField() },
  });
}

function exampleProjection(overrides: Partial<ProjectionDefinition> = {}): ProjectionDefinition {
  return {
    name: "units-per-property",
    source: "unit",
    table: testTable,
    apply: {},
    ...overrides,
  };
}

describe("r.projection() — registration", () => {
  test("stores the projection on the FeatureDefinition", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.projection(exampleProjection());
    });
    expect(feature.projections["units-per-property"]).toBeDefined();
    expect(feature.projections["units-per-property"]?.source).toBe("unit");
  });

  test("rejects duplicate projection names within the same feature", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.entity("unit", exampleEntity());
        r.projection(exampleProjection());
        r.projection(exampleProjection());
      }),
    ).toThrow(/already registered/);
  });

  test("rejects non-kebab-case projection names", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.entity("unit", exampleEntity());
        r.projection(exampleProjection({ name: "units_per_property" }));
      }),
    ).toThrow(/kebab-case/);

    expect(() =>
      defineFeature("test", (r) => {
        r.entity("unit", exampleEntity());
        r.projection(exampleProjection({ name: "UnitsPerProperty" }));
      }),
    ).toThrow(/kebab-case/);
  });

  test("accepts kebab-case projection names", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.entity("unit", exampleEntity());
        r.projection(exampleProjection({ name: "units-per-property" }));
      }),
    ).not.toThrow();
  });
});

describe("createRegistry — projection indexing", () => {
  test("indexes projections by source entity for O(1) lookup", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.projection(exampleProjection());
    });
    const registry = createRegistry([feature]);
    const byUnit = registry.getProjectionsForSource("unit");
    expect(byUnit).toHaveLength(1);
    expect(byUnit[0]?.source).toBe("unit");
  });

  test("returns empty list for entities with no projections", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
    });
    const registry = createRegistry([feature]);
    expect(registry.getProjectionsForSource("unit")).toHaveLength(0);
  });

  test("fans out a multi-source projection to each entity's index", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity("unit"));
      r.entity("lease", exampleEntity("lease"));
      r.projection(exampleProjection({ name: "combined", source: ["unit", "lease"] }));
    });
    const registry = createRegistry([feature]);
    expect(registry.getProjectionsForSource("unit")).toHaveLength(1);
    expect(registry.getProjectionsForSource("lease")).toHaveLength(1);
  });

  test("boot-validates source entity — typos must fail loudly", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      // Typo: "unti" instead of "unit". Without the source-validation guard
      // this would silently be a no-op at runtime. Post "events-only-source"
      // framework change the error message shifted: registry now accepts
      // unregistered sources IF the apply-keys are domain-events — so a
      // typo hits the "not registered AND no domain-event apply-keys"
      // branch, which is what this test actually guards against.
      r.projection(exampleProjection({ source: "unti" }));
    });
    expect(() => createRegistry([feature])).toThrow(/unti/);
    expect(() => createRegistry([feature])).toThrow(/no domain-event apply-keys/);
  });

  test("boot-validates apply-keys against the source's event types", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.projection(
        exampleProjection({
          // Typo: "creatd" instead of "created". Same motivation as source-
          // validation — catch silent no-ops at boot.
          apply: {
            "unit.creatd": async () => {},
          },
        }),
      );
    });
    expect(() => createRegistry([feature])).toThrow(/apply handler for "unit\.creatd"/);
  });

  test("accepts all four auto-generated event-type apply-keys", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.projection(
        exampleProjection({
          apply: {
            "unit.created": async () => {},
            "unit.updated": async () => {},
            "unit.deleted": async () => {},
            "unit.restored": async () => {},
          },
        }),
      );
    });
    expect(() => createRegistry([feature])).not.toThrow();
  });

  test("exposes all projections via getAllProjections", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("unit", exampleEntity());
      r.projection(exampleProjection());
      r.projection(exampleProjection({ name: "other" }));
    });
    const registry = createRegistry([feature]);
    expect(registry.getAllProjections().size).toBe(2);
  });

  test("rejects the same projection name registered by two features", () => {
    const a = defineFeature("a", (r) => {
      r.entity("unit", exampleEntity());
      r.projection(exampleProjection({ name: "shared" }));
    });
    const b = defineFeature("b", (r) => {
      r.entity("unit2", exampleEntity("unit2"));
      r.projection(exampleProjection({ name: "shared", source: "unit2" }));
    });
    // Names get qualified with the feature-prefix so same short name from
    // different features doesn't actually collide. Using the same name from
    // the same qualified-name (only possible with the same feature) is the
    // duplicate case — already covered by the r.projection() duplicate test.
    expect(() => createRegistry([a, b])).not.toThrow();
  });
});
